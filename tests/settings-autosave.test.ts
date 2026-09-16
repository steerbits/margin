import test from "node:test";
import assert from "node:assert/strict";
import { SettingsAutosave } from "../src/settings-autosave.ts";
import { defaultSettings, type MarginSettings } from "../shared/settings.ts";
const choice = (id: string): MarginSettings => ({
  ...defaultSettings,
  defaultModel: { provider: "test", id },
});
test("autosave serializes writes and retains the latest change while a request is pending", async () => {
  const written: MarginSettings[] = [];
  let release!: () => void;
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new SettingsAutosave(
    defaultSettings,
    async (settings) => {
      written.push(settings);
      if (written.length === 1) await first;
    },
    () => {},
  );
  queue.update(choice("first"));
  await Promise.resolve();
  queue.update(choice("second"));
  queue.update({ ...choice("last"), defaultThinkingLevel: "high" });
  assert.equal(written.length, 1);
  const closing = queue.flush();
  assert.equal(queue.saving, true);
  release();
  assert.equal(await closing, true);
  assert.deepEqual(
    written.map((x) => x.defaultModel?.id),
    ["first", "last"],
  );
  assert.deepEqual(queue.saved, {
    ...choice("last"),
    defaultThinkingLevel: "high",
  });
});

test("an unacknowledged write stays dirty even when the newest choice equals the last acknowledged value", async () => {
  let release!: () => void;
  let persisted = defaultSettings;
  let calls = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queue = new SettingsAutosave(
    defaultSettings,
    async (value) => {
      persisted = value;
      if (++calls === 1) {
        await gate;
        throw new Error("Response lost after commit");
      }
    },
    () => {},
  );
  queue.update(choice("temporary"));
  await Promise.resolve();
  queue.update(defaultSettings);
  release();
  assert.equal(await queue.flush(), false);
  queue.retry();
  assert.equal(await queue.flush(), true);
  assert.deepEqual(persisted, defaultSettings);
  assert.equal(calls, 2);
});
test("failed autosave keeps the newest draft, refuses a silent close, and retries it", async () => {
  let fail = true;
  const queue = new SettingsAutosave(
    defaultSettings,
    async () => {
      if (fail) throw new Error("offline");
    },
    () => {},
  );
  queue.update(choice("new"));
  assert.equal(await queue.flush(), false);
  assert.equal(queue.error, "offline");
  assert.deepEqual(queue.saved, defaultSettings);
  assert.deepEqual(queue.draft, choice("new"));
  fail = false;
  queue.retry();
  assert.equal(await queue.flush(), true);
  assert.equal(queue.error, "");
});
