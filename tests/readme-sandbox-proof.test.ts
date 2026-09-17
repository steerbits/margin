import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateSandboxEvidence,
  readSandboxProof,
  sandboxCommand,
} from "../scripts/readme-demos/sandbox-proof.ts";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, join } from "node:path";

const valid = {
  insideWritten: true,
  outsideCreated: false,
  sentinelUnchanged: true,
  exitCode: 1,
  stderr: "/bin/sh: ../outside/hello.txt: Operation not permitted",
};

test("sandbox demo requires both an allowed inside write and an actual denied outside write", () => {
  assert.doesNotThrow(() => validateSandboxEvidence(valid));
  for (const change of [
    { insideWritten: false },
    { outsideCreated: true },
    { sentinelUnchanged: false },
    { exitCode: 0 },
    { exitCode: NaN },
    { exitCode: -1 },
    { stderr: "../outside/hello.txt: No such file or directory" },
    { stderr: "sandbox-exec: sandbox_apply: Operation not permitted" },
  ])
    assert.throws(() => validateSandboxEvidence({ ...valid, ...change }));
});

test("sandbox startup failure cannot become a successful security demo", () => {
  assert.throws(
    () =>
      validateSandboxEvidence({
        ...valid,
        insideWritten: false,
        exitCode: 71,
        stderr: "sandbox-exec: sandbox_apply: Operation not permitted",
      }),
    /must actually launch/,
  );
});

test("saved evidence is read-only and tied to the exact command and bundled cco", async () => {
  const parent = resolve(".margin-data/temporary/readme-sandbox-proof-tests");
  await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(join(parent, "proof-"));
  const path = join(folder, "proof.json");
  const fixture = {
    ...valid,
    verified: true,
    backend: "native",
    command: sandboxCommand,
    ccoSha256: createHash("sha256")
      .update(await readFile(resolve("vendor/cco/cco")))
      .digest("hex"),
  };
  try {
    const content = JSON.stringify(fixture);
    await writeFile(path, content);
    assert.deepEqual(await readSandboxProof(path), fixture);
    assert.equal(await readFile(path, "utf8"), content);
    for (const change of [
      { verified: false },
      { backend: "mock" },
      { command: "different command" },
      { ccoSha256: "stale" },
    ]) {
      await writeFile(path, JSON.stringify({ ...fixture, ...change }));
      await assert.rejects(() => readSandboxProof(path));
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
