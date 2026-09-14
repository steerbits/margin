import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { managedShell } from "../server/managed-shell.ts";
import { RuntimeOwner, processState } from "../server/runtime-owner.ts";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
async function until(predicate: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!predicate() && Date.now() < end) await delay(20);
  assert.ok(predicate(), "condition reached within deadline");
}
test("managed Bash preserves output, exit status, timeout and abort semantics", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-managed-shell-"));
  const owner = new RuntimeOwner(dir);
  const id = owner.reserve().generation;
  owner.claim(id);
  const shell = managedShell({ storage: owner, generation: id });
  let output = "";
  try {
    assert.deepEqual(
      await shell.exec(
        "printf '%s' hello; printf '%s' error >&2; exit 7",
        dir,
        { onData: (b) => (output += b) },
      ),
      { exitCode: 7 },
    );
    assert.ok(output.includes("hello") && output.includes("error"));
    assert.deepEqual(owner.current()?.guardians, []);
    await assert.rejects(
      shell.exec("sleep 20", dir, { onData() {}, timeout: 0.1 }),
      /timeout:0.1/,
    );
    const abort = new AbortController();
    const work = shell.exec("sleep 20", dir, {
      onData() {},
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 100);
    await assert.rejects(work, /aborted/);
    await assert.rejects(
      shell.exec("echo bad", dir, { onData() {}, timeout: -1 }),
      /Invalid/,
    );
    await assert.rejects(
      shell.exec("echo bad", dir, { onData() {}, signal: AbortSignal.abort() }),
      /aborted/,
    );
  } finally {
    owner.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
for (const background of [false, true])
  test(
    `SDK host SIGKILL stops ${background ? "post-shell-exit output producers" : "the in-flight command"} through guardian IPC`,
    { timeout: 15000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "margin-guardian-crash-"));
      const owner = new RuntimeOwner(dir);
      const id = owner.reserve().generation;
      const heartbeat = join(dir, "heartbeat");
      const childInfo = join(dir, "command-pid");
      const command = join(dir, "command.cjs");
      const host = join(dir, "host.mjs");
      // The watchdog bounds this test even if the behavior regresses.
      writeFileSync(
        command,
        `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(childInfo)},String(process.pid));let n=0;setInterval(()=>{fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n));process.stdout.write('.');},30);setTimeout(()=>process.exit(0),8000);`,
      );
      writeFileSync(
        host,
        `import {RuntimeOwner} from ${JSON.stringify(pathToFileURL(resolve("server/runtime-owner.ts")).href)};import {managedShell} from ${JSON.stringify(pathToFileURL(resolve("server/managed-shell.ts")).href)};const storage=new RuntimeOwner(${JSON.stringify(dir)});storage.claim(${JSON.stringify(id)});await managedShell({storage,generation:${JSON.stringify(id)}}).exec(${JSON.stringify(`exec ${quote(process.execPath)} ${quote(command)}${background ? " &" : ""}`)},${JSON.stringify(dir)},{onData(){}});`,
      );
      const sdkHost = spawn(process.execPath, ["--import", "tsx", host], {
        stdio: "ignore",
      });
      try {
        await until(() => existsSync(heartbeat));
        const commandPid = Number(readFileSync(childInfo, "utf8"));
        await delay(250);
        assert.equal(processState(commandPid), "alive");
        const guardianPid = owner.current()!.guardians[0];
        assert.ok(guardianPid);
        const died = once(sdkHost, "exit");
        sdkHost.kill("SIGKILL");
        await died;
        await until(() => processState(guardianPid) === "dead");
        await delay(100);
        const count = readFileSync(heartbeat, "utf8");
        await delay(150);
        assert.equal(
          readFileSync(heartbeat, "utf8"),
          count,
          "command no longer produces side effects",
        );
        assert.equal(processState(commandPid), "dead");
        assert.equal(
          owner.reserve().previous?.generation,
          id,
          "takeover only after runtime and guardian death",
        );
      } finally {
        if (sdkHost.exitCode === null && sdkHost.signalCode === null)
          sdkHost.kill("SIGKILL");
        // No process enumeration or unrelated process signaling in this test.
        owner.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
test("managed Bash drains large foreground output and delayed descendant output without dropping the tail", async () => {
  const dir = mkdtempSync(join(tmpdir(), "margin-shell-output-"));
  const program = join(dir, "output.cjs");
  writeFileSync(
    program,
    `process.stdout.write('x'.repeat(2*1024*1024));let n=0;const timer=setInterval(()=>{process.stdout.write('tail'+(++n));if(n===8){clearInterval(timer);process.stdout.write('END');}},30);`,
  );
  try {
    let output = "";
    const result = await managedShell().exec(
      `${quote(process.execPath)} ${quote(program)} &`,
      dir,
      { onData: (b) => (output += b), timeout: 5 },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(
      output,
      "x".repeat(2 * 1024 * 1024) +
        Array.from({ length: 8 }, (_, i) => `tail${i + 1}`).join("") +
        "END",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
