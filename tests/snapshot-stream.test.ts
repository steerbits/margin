import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import http, { type ServerResponse } from "node:http";
import { snapshotStream } from "../server/snapshot-stream.ts";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Response extends EventEmitter {
  writes: string[] = [];
  accepting = false;
  writableLength = 0;
  destroyed = false;
  write(text: string) {
    this.writes.push(text);
    this.writableLength += text.length;
    return this.accepting;
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
  get http() {
    return this as unknown as ServerResponse;
  }
}
test("backpressure retains only the latest snapshot, defers serialization and skips heartbeats", () => {
  const res = new Response();
  let serialized = 0,
    closes = 0;
  const s = snapshotStream(res.http, {
    serialize: (value: number) => {
      serialized++;
      return String(value);
    },
    onClose: () => closes++,
  });
  s.send(0);
  for (let i = 1; i <= 10_000; i++) {
    s.send(i);
    s.heartbeat();
  }
  assert.equal(serialized, 1);
  assert.deepEqual(res.writes, ["0"]);
  res.accepting = true;
  res.emit("drain");
  assert.deepEqual(res.writes, ["0", "10000"]);
  s.send(10001);
  s.heartbeat();
  assert.deepEqual(res.writes.slice(-2), ["10001", "event: heartbeat\ndata: {}\n\n"]);
  res.destroy();
  s.close();
  s.send(10002);
  assert.equal(closes, 1);
  assert.equal(res.listenerCount("drain"), 0);
});
test("repeated blocked drains remain bounded and healthy drains cancel the stall timer", async () => {
  const res = new Response();
  const s = snapshotStream(res.http, {
    serialize: String,
    onClose() {},
    stallMs: 30,
  });
  s.send(0);
  s.send(1);
  res.emit("drain");
  s.send(2);
  assert.deepEqual(res.writes, ["0", "1"]);
  res.accepting = true;
  res.emit("drain");
  await delay(50);
  assert.equal(res.destroyed, false);
  assert.deepEqual(res.writes, ["0", "1", "2"]);
  s.close();
});
test("a permanently stalled connection is closed without aborting agent work", async () => {
  const res = new Response();
  let closes = 0,
    stalled = 0;
  const s = snapshotStream(res.http, {
    serialize: String,
    onClose: () => closes++,
    onStall: () => stalled++,
    stallMs: 10,
  });
  s.send(0);
  s.send(1);
  await delay(30);
  assert.equal(res.destroyed, true);
  assert.equal(closes, 1);
  assert.equal(stalled, 1);
  assert.deepEqual(res.writes, ["0"]);
});
test("serialization and response errors close only the subscription", () => {
  for (const mode of ["serialize", "response"] as const) {
    const res = new Response();
    let closes = 0;
    const s = snapshotStream(res.http, {
      serialize() {
        if (mode === "serialize") throw new Error("bad JSON");
        return "ok";
      },
      onClose: () => closes++,
    });
    s.send(0);
    if (mode === "response") res.emit("error", new Error("disconnected"));
    assert.equal(closes, 1);
    assert.equal(res.destroyed, true);
  }
});
test("real stalled HTTP socket cannot accumulate one full conversation per update", async () => {
  let stream: ReturnType<typeof snapshotStream<string>> | undefined;
  let response: ServerResponse | undefined;
  let serialized = 0,
    closed = 0;
  const server = http
    .createServer((_req, res) => {
      response = res;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      stream = snapshotStream(res, {
        serialize: (text: string) => {
          serialized++;
          return text;
        },
        onClose: () => closed++,
      });
      stream.send("data: " + "x".repeat(512 * 1024) + "\n\n");
    })
    .listen(0, "127.0.0.1");
  await once(server, "listening");
  const req = http.get(
    `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
  );
  const [client] = await once(req, "response");
  client.pause();
  try {
    for (let i = 0; i < 150; i++) {
      stream!.send("data: " + "x".repeat(512 * 1024) + i + "\n\n");
      await delay(2);
      assert.ok(response!.writableLength < 600 * 1024);
    }
    assert.ok(
      serialized < 30,
      `serialized only ${serialized} snapshots for a stalled consumer`,
    );
  } finally {
    const disconnected = once(response!, "close");
    client.destroy();
    req.destroy();
    server.closeAllConnections();
    await disconnected;
    await new Promise<void>((r) => server.close(() => r()));
  }
  assert.equal(closed, 1);
});
