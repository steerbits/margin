import test from "node:test";
import assert from "node:assert/strict";
import { NativeDirectoryPicker } from "../server/native-directory-picker.ts";

test("native chooser passes literal path arguments and preserves the selected absolute path", async () => {
  const selected = '/Users/test/Project 日本語; $(touch nope) "quoted"\nfolder';
  const calls: unknown[] = [];
  const picker = new NativeDirectoryPicker(
    "/app with spaces",
    async (command, args) => {
      calls.push({ command, args });
      return JSON.stringify({ path: selected }) + "\n";
    },
    "darwin",
  );
  assert.equal(await picker.choose("/Users/test/Projects"), selected);
  assert.deepEqual(calls, [
    {
      command: "/usr/bin/osascript",
      args: [
        "-l",
        "JavaScript",
        "/app with spaces/scripts/choose-workspace.jxa.js",
        "/Users/test/Projects",
      ],
    },
  ]);
});
test("cancel and invalid results release the chooser for retry", async () => {
  let result = '{"path":null}';
  const picker = new NativeDirectoryPicker(
    "/app",
    async () => result,
    "darwin",
  );
  assert.equal(await picker.choose("/Users/test"), null);
  for (const invalid of [
    '{"path":"relative"}',
    "{}",
    '{"path":42}',
    "not JSON",
  ]) {
    result = invalid;
    await assert.rejects(picker.choose("/Users/test"));
  }
  result = '{"path":"/Users/test/Project"}';
  assert.equal(await picker.choose("/Users/test"), "/Users/test/Project");
});
test("only one native chooser opens at a time and disconnect/shutdown abort its process", async () => {
  const picker = new NativeDirectoryPicker(
    "/app",
    async (_command, _args, signal) => {
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        }),
      );
      return '{"path":null}';
    },
    "darwin",
  );
  const abort = new AbortController();
  const pending = picker.choose("/Users/test", abort.signal);
  const rejected = assert.rejects(pending, /aborted/);
  await assert.rejects(picker.choose("/Users/test"), /already open/);
  abort.abort();
  await rejected;
  const another = picker.choose("/Users/test");
  const closed = assert.rejects(another, /aborted/);
  picker.close();
  await closed;
});
test("unsupported platforms fail explicitly without invoking a process", async () => {
  const picker = new NativeDirectoryPicker(
    "/app",
    async () => {
      throw new Error("should not run");
    },
    "linux",
  );
  await assert.rejects(picker.choose("/home/test"), /currently supports macOS/);
});
