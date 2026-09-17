import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { bundledCco } from "../installation.ts";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
export const sandboxCommand = "printf 'hello\\n' > ../outside/hello.txt";

export function validateSandboxEvidence(evidence: {
  insideWritten: boolean;
  outsideCreated: boolean;
  sentinelUnchanged: boolean;
  exitCode: number;
  stderr: string;
}) {
  assert.equal(
    evidence.insideWritten,
    true,
    "Sandbox must actually launch and permit an inside write; sandbox_apply failure is not proof",
  );
  assert(
    Number.isInteger(evidence.exitCode) &&
      evidence.exitCode > 0 &&
      evidence.exitCode <= 255,
    "Outside write must report a nonzero process exit code",
  );
  assert.match(
    evidence.stderr,
    /outside\/hello\.txt.*(?:Operation not permitted|Permission denied|Read-only file system)/i,
  );
  assert.equal(
    evidence.outsideCreated,
    false,
    "Outside file must remain absent",
  );
  assert.equal(
    evidence.sentinelUnchanged,
    true,
    "Outside sentinel must remain unchanged",
  );
}

/** Real native-cco execution, not the browser fixture's unsandboxed fake agent. */
export async function verifySandbox(parent: string) {
  await mkdir(parent, { recursive: true });
  await rm(join(parent, "proof.json"), { force: true });
  // Not /tmp: cco deliberately permits writes there. All targets are disposable.
  const root = await mkdtemp(join(resolve(parent), "probe-"));
  const inside = join(root, "workspace");
  const outside = join(root, "outside");
  const cco = bundledCco(resolve(import.meta.dirname, "../.."));
  await mkdir(inside);
  await mkdir(outside);
  await writeFile(join(outside, "sentinel.txt"), "unchanged");
  try {
    let exitCode = 0,
      stdout = "",
      stderr = "";
    try {
      ({ stdout, stderr } = await run(
        cco,
        [
          "--backend",
          "native",
          "--command",
          "/bin/sh",
          "-c",
          `printf 'allowed\\n' > allowed.txt && ${sandboxCommand}`,
        ],
        { cwd: inside, timeout: 30_000, maxBuffer: 1024 * 1024 },
      ));
    } catch (error) {
      const failure = error as {
        code?: number;
        stdout?: string;
        stderr?: string;
      };
      if (typeof failure.code !== "number") throw error;
      exitCode = failure.code;
      stdout = failure.stdout ?? "";
      stderr = failure.stderr ?? "";
    }
    await writeFile(
      join(parent, "attempt.json"),
      JSON.stringify({ exitCode, stdout, stderr }, null, 2),
    );
    const insideWritten = await readFile(
      join(inside, "allowed.txt"),
      "utf8",
    ).catch(() => "");
    const outsideCreated = await access(join(outside, "hello.txt")).then(
      () => true,
      () => false,
    );
    validateSandboxEvidence({
      insideWritten: insideWritten === "allowed\n",
      outsideCreated,
      sentinelUnchanged:
        (await readFile(join(outside, "sentinel.txt"), "utf8")) === "unchanged",
      exitCode,
      stderr,
    });
    const proof = {
      verified: true,
      backend: "native",
      command: sandboxCommand,
      exitCode,
      stdout,
      stderr: stderr
        .split("\n")
        .filter((line) => line.includes("../outside/hello.txt"))
        .join("\n"),
      insideWritten: true,
      outsideCreated,
      sentinelUnchanged: true,
      ccoSha256: createHash("sha256")
        .update(await readFile(cco))
        .digest("hex"),
      presentation:
        "Verified native sandbox output, eligible for replay in an isolated browser fixture; no live inference.",
    };
    await writeFile(join(parent, "proof.json"), JSON.stringify(proof, null, 2));
    return proof;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** Load a previously completed host-terminal probe; never rerun or erase it. */
export async function readSandboxProof(path: string) {
  const proof: Awaited<ReturnType<typeof verifySandbox>> = JSON.parse(
    await readFile(path, "utf8"),
  );
  assert.equal(proof.verified, true);
  assert.equal(proof.backend, "native");
  assert.equal(proof.command, sandboxCommand);
  validateSandboxEvidence(proof);
  const cco = bundledCco(resolve(import.meta.dirname, "../.."));
  assert.equal(
    proof.ccoSha256,
    createHash("sha256")
      .update(await readFile(cco))
      .digest("hex"),
    "Sandbox proof must match the current bundled cco",
  );
  return proof;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const parent = resolve(".margin-data/temporary/readme-speed-options/sandbox");
  verifySandbox(parent)
    .then((proof) => {
      console.log(proof.stderr);
      console.log(
        `Verified inside write + blocked outside write. Evidence: ${join(parent, "proof.json")}`,
      );
    })
    .catch((error) => {
      console.error(error.message);
      console.error(
        `No sandbox protection is claimed. See ${join(parent, "attempt.json")}. Run from a normal terminal if sandbox_apply is denied.`,
      );
      process.exitCode = 1;
    });
}
