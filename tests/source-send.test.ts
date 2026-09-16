import { test } from "node:test";
import assert from "node:assert/strict";
import { SourceSendGuard } from "../server/source-send.ts";
import { sourceSendConflict } from "../shared/source-send.ts";

test("busy source sends expose a useful reason and the blocking conversation", async () => {
  const guard = new SourceSendGuard(
    () => ["running-chat"],
    () => false,
  );
  assert.deepEqual(guard.block(), {
    reason: sourceSendConflict,
    sessionId: "running-chat",
  });
  let started = false;
  await assert.rejects(
    guard.run("new-chat", async () => {
      started = true;
    }),
    {
      message: sourceSendConflict,
    },
  );
  assert.equal(started, false);
});

test("background/plugin work without a conversation still blocks sending", () => {
  const guard = new SourceSendGuard(
    () => [],
    () => true,
  );
  assert.deepEqual(guard.block(), { reason: sourceSendConflict });
});

test("simultaneous sends cannot both enter before the runtime reports busy", async () => {
  let release!: () => void;
  let active: string[] = [];
  const guard = new SourceSendGuard(
    () => active,
    () => false,
  );
  const first = guard.run(
    "a",
    () =>
      new Promise<string>((resolve) => {
        release = () => {
          active = ["a"];
          resolve("accepted");
        };
      }),
  );
  assert.equal(guard.isStarting, true);
  assert.equal(guard.block()?.sessionId, "a");
  await assert.rejects(
    guard.run("b", async () => "incorrect overlap"),
    { message: sourceSendConflict },
  );
  release();
  assert.equal(await first, "accepted");
  assert.equal(guard.isStarting, false);
  await assert.rejects(
    guard.run("b", async () => "still overlaps"),
    { message: sourceSendConflict },
  );
  active = [];
  assert.equal(guard.block(), null);
  // No queue: only another explicit send starts B.
  assert.equal(await guard.run("b", async () => "accepted"), "accepted");
});

test("a failed send releases the reservation without hiding active work", async () => {
  const guard = new SourceSendGuard(
    () => [],
    () => false,
  );
  await assert.rejects(
    guard.run("a", async () => {
      throw new Error("bad input");
    }),
    /bad input/,
  );
  assert.equal(guard.isStarting, false);
  assert.equal(guard.block(), null);
  assert.equal(await guard.run("b", async () => "accepted"), "accepted");
});
