import test from "node:test";
import assert from "node:assert/strict";
import { connectConversation } from "../src/conversation-connection.ts";
import type { Snapshot } from "../shared/types.ts";

class Stream extends EventTarget {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  message(id = "chat", text = "latest") {
    this.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          snapshot: { session: { id }, messages: [{ text }] },
        }),
      }),
    );
  }
}
function fixture() {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const streams: Stream[] = [];
  const received: Snapshot[] = [];
  const connections: boolean[] = [];
  const urls: string[] = [];
  let now = 0;
  const close = connectConversation(
    {
      sessionId: "chat",
      onSnapshot: (snapshot) => received.push(snapshot),
      onConnection: (connected) => connections.push(connected),
    },
    {
      window,
      document,
      now: () => now,
      open: (url) => {
        urls.push(url);
        const s = new Stream();
        streams.push(s);
        return s as unknown as EventSource;
      },
    },
  );
  return {
    window,
    document,
    streams,
    received,
    connections,
    urls,
    close,
    time: (ms: number) => (now = ms),
  };
}

test("wake signals coalesce, replace the subscription and accept only a current full snapshot", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  try {
    f.streams[0].message();
    assert.equal(f.connections.at(-1), true);
    for (const name of ["focus", "online", "pageshow"])
      f.window.dispatchEvent(new Event(name));
    f.document.dispatchEvent(new Event("visibilitychange"));
    t.mock.timers.tick(100);
    assert.equal(f.streams.length, 2);
    assert.equal(f.streams[0].closed, true);
    assert.equal(f.connections.at(-1), false);
    f.streams[0].message("chat", "stale");
    f.streams[0].onerror?.();
    f.streams[1].message("chat", "finished while away");
    assert.deepEqual(
      f.received.map((s) => s.messages[0].text),
      ["latest", "finished while away"],
    );
    assert.equal(f.connections.at(-1), true);
    assert.deepEqual(f.urls, [
      "/api/sessions/chat/events",
      "/api/sessions/chat/events",
    ]);
  } finally {
    f.close();
  }
});

test("a silent stale stream is detected after sleep even without a focus or online event", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  try {
    f.streams[0].message();
    f.time(8 * 60 * 60 * 1000); // a clock gap, not eight hours of retry timers
    t.mock.timers.tick(5000);
    assert.equal(f.streams.length, 2);
    assert.equal(f.streams[0].closed, true);
    f.streams[1].message();
    f.time(8 * 60 * 60 * 1000 + 40_000);
    f.streams[1].dispatchEvent(new Event("heartbeat"));
    t.mock.timers.tick(5000);
    assert.equal(
      f.streams.length,
      2,
      "healthy idle heartbeat does not reconnect",
    );
  } finally {
    f.close();
  }
});

test("closed/malformed streams retry with bounded backoff; a snapshot resets the delay", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  try {
    f.streams[0].onerror?.();
    t.mock.timers.tick(999);
    assert.equal(f.streams.length, 1);
    t.mock.timers.tick(1);
    f.streams[1].message("wrong-chat");
    t.mock.timers.tick(2000);
    f.streams[2].message();
    f.streams[2].onerror?.();
    t.mock.timers.tick(1000);
    assert.equal(f.streams.length, 4);
    for (let i = 0; i < 8; i++) {
      f.streams.at(-1)!.onerror?.();
      const before: number = f.streams.length;
      t.mock.timers.tick(15_000);
      assert.equal(f.streams.length, before + 1);
    }
  } finally {
    f.close();
  }
});

test("offline clears Connected, hidden tabs ignore focus, cleanup cancels pending work and late events", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const f = fixture();
  f.streams[0].message();
  f.document.visibilityState = "hidden";
  f.window.dispatchEvent(new Event("focus"));
  t.mock.timers.tick(100);
  assert.equal(f.streams.length, 1);
  f.window.dispatchEvent(new Event("offline"));
  assert.equal(f.connections.at(-1), false);
  f.close();
  const before = f.received.length;
  f.streams[0].message();
  f.streams[0].onerror?.();
  f.window.dispatchEvent(new Event("online"));
  f.document.dispatchEvent(new Event("visibilitychange"));
  t.mock.timers.tick(60_000);
  assert.equal(f.streams.length, 1);
  assert.equal(f.received.length, before);
});
