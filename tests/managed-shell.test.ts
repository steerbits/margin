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
    `SDK host SIGKILL stops ${background ? "post-shell-exit output producers after slow startup" : "the in-flight command"} through guardian IPC`,
    { timeout: 15000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "margin-guardian-crash-"));
      const owner = new RuntimeOwner(dir);
      const id = owner.reserve().generation;
      const heartbeat = join(dir, "heartbeat");
      const childInfo = join(dir, "command-pid");
      const shellInfo = join(dir, "shell-pid");
      const command = join(dir, "command.cjs");
      const host = join(dir, "host.mjs");
      // The watchdog bounds this test even if the behavior regresses.
      writeFileSync(
        command,
        `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(childInfo)},String(process.pid));let n=0;setTimeout(()=>setInterval(()=>{process.stdout.write('.');fs.writeFileSync(${JSON.stringify(heartbeat)},String(++n));},30),${background ? 250 : 0});setTimeout(()=>process.exit(0),8000);`,
      );
      const invocation = `exec ${quote(process.execPath)} ${quote(command)}`;
      // This case tests an already-producing descendant after its shell exits,
      // not a quiet background service. Wait for output readiness so Node's
      // startup cannot race the normal 100ms post-exit output grace. Deliberately
      // slow startup exercises the handshake even on otherwise fast machines.
      const shellCommand = background
        ? `printf '%s' "$$" > ${quote(shellInfo)}; ${invocation} & child=$!; while [ ! -s ${quote(heartbeat)} ] && kill -0 "$child" 2>/dev/null; do sleep 0.01; done`
        : invocation;
      writeFileSync(
        host,
        `import {RuntimeOwner} from ${JSON.stringify(pathToFileURL(resolve("server/runtime-owner.ts")).href)};import {managedShell} from ${JSON.stringify(pathToFileURL(resolve("server/managed-shell.ts")).href)};const storage=new RuntimeOwner(${JSON.stringify(dir)});storage.claim(${JSON.stringify(id)});await managedShell({storage,generation:${JSON.stringify(id)}}).exec(${JSON.stringify(shellCommand)},${JSON.stringify(dir)},{onData(){}});`,
      );
      const sdkHost = spawn(process.execPath, ["--import", "tsx", host], {
        stdio: "ignore",
      });
      try {
        await until(() => existsSync(heartbeat));
        const commandPid = Number(readFileSync(childInfo, "utf8"));
        if (background) {
          const shellPid = Number(readFileSync(shellInfo, "utf8"));
          assert.notEqual(shellPid, commandPid);
          await until(() => processState(shellPid) === "dead");
        }
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
  const ready = join(dir, "output-ready");
  writeFileSync(
    program,
    `const fs=require('node:fs');setTimeout(()=>process.stdout.write('x'.repeat(2*1024*1024),()=>{fs.writeFileSync(${JSON.stringify(ready)},'ready');let n=0;const timer=setInterval(()=>{process.stdout.write('tail'+(++n));if(n===8){clearInterval(timer);process.stdout.write('END');}},30);}),250);`,
  );
  try {
    let output = "";
    const result = await managedShell().exec(
      // Let the shell exit only once the producer is active, then verify that
      // all subsequent descendant output is drained, including the final tail.
      `${quote(process.execPath)} ${quote(program)} & child=$!; while [ ! -s ${quote(ready)} ] && kill -0 "$child" 2>/dev/null; do sleep 0.01; done`,
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
