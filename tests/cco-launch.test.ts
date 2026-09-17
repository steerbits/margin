import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, chmod, rm, copyFile, symlink, realpath } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ccoLaunchPlan, parseLaunchOptions } from "../scripts/start-cco.ts";
import { executionInfo, withinPath } from "../server/execution.ts";

test("cco launch wraps the Node SDK server with ordinary defaults and Pi state", () => {
  const options = parseLaunchOptions([], "/app");
  const plan = ccoLaunchPlan(
    options,
    "/app",
    "/app/.margin-data",
    "/home/me/.pi",
    {},
  );
  assert.equal(plan.command, "/app/vendor/cco/cco");
  assert.deepEqual(plan.args.slice(0, 2), ["--backend", "native"]);
  assert.equal(plan.cwd, "/app");
  assert.ok(plan.args.includes("--add-dir=/home/me/.pi"));
  assert.deepEqual(plan.args.slice(-4), [
    "--command",
    "node",
    "/app/node_modules/tsx/dist/cli.mjs",
    "/app/server/index.ts",
  ]);
  assert.ok(
    !plan.args.some((x) =>
      ["--safe", "--deny-path", "--allow-keychain"].includes(x),
    ),
  );
  assert.ok(!plan.args.includes("--allow-readonly=/app"));
  assert.equal(plan.launch.projectRoot, "/app");
});
test("separate writable projects and paths with shell characters are passed as literal arguments", () => {
  const project = "/home/me/project with spaces; $(echo nope)";
  const options = parseLaunchOptions(
    ["--project", project, "--add-dir", "/work/other", "--dev"],
    "/app",
  );
  const plan = ccoLaunchPlan(
    options,
    "/app",
    "/app/.margin-data",
    "/home/me/.pi",
    { PORT: "4317" },
  );
  assert.equal(plan.cwd, project);
  assert.ok(plan.args.includes("--add-dir=/work/other"));
  assert.ok(plan.args.includes("--allow-readonly=/app"));
  assert.ok(plan.args.includes("watch"));
  assert.ok(plan.args.includes("PORT=4317"));
  assert.equal(withinPath("/work/project-two", "/work/project"), false);
});
test("execution information is explicit, and invalid configuration does not silently select native", () => {
  assert.deepEqual(executionInfo(""), { mode: "native" });
  assert.deepEqual(
    executionInfo(
      JSON.stringify({
        mode: "cco",
        projectRoot: "/app",
        writablePaths: ["/app"],
      }),
    ),
    { mode: "cco", projectRoot: "/app", writablePaths: ["/app"] },
  );
  assert.throws(() => executionInfo("{broken"));
  assert.throws(() => executionInfo('{"mode":"cco"}'));
  assert.throws(() => parseLaunchOptions(["--project"], "/app"));
  assert.throws(() => parseLaunchOptions(["--safe"], "/app"));
});
test("a cco failure is propagated without launching a native server", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "margin-cco-launch-")));
  try {
    const bin = join(root, "vendor", "cco");
    await mkdir(bin, { recursive: true });
    await mkdir(join(root, "scripts"));
    await mkdir(join(root, "server"));
    for (const file of ["scripts/start-cco.ts", "scripts/installation.ts", "scripts/launch-port.mjs", "server/execution.ts", "package.json"])
      await copyFile(resolve(file), join(root, file));
    await symlink(resolve("node_modules"), join(root, "node_modules"), "dir");
    const fake = join(bin, "cco");
    await writeFile(fake, "#!/bin/sh\nexit 71\n");
    await chmod(fake, 0o755);
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/tsx/dist/cli.mjs"),
        join(root, "scripts/start-cco.ts"),
        "--project",
        root,
      ],
      {
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          MARGIN_DATA_DIR: join(root, "data"),
          PI_CODING_AGENT_DIR: join(root, "pi"),
        },
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(result.status, 71, result.stderr + result.stdout);
    assert.match(result.stderr, /not fallen back to native/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
