import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSandboxEvidence } from "../scripts/readme-demos/sandbox-proof.ts";

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
