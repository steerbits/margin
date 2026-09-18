import test from "node:test";
import assert from "node:assert/strict";
import {
  spawn,
  spawnSync,
  execFileSync,
  type ChildProcess,
} from "node:child_process";
import { once } from "node:events";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { claimLauncher } from "../scripts/launcher-owner.ts";
import {
  cleanEnvironment,
  terminalMode,
  occupyPorts,
  runInTerminal,
  temporaryRoot,
} from "./launch-fixtures.ts";

function fixture(installed = true) {
  const root = temporaryRoot("checkout with spaces-");
  for (const file of [
    "start.sh",
    "install.sh",
    "package.json",
    "scripts/start-margin.ts",
    "scripts/startup-build.ts",
    "scripts/start-verified.ts",
    "scripts/start-cco.ts",
    "scripts/installation.ts",
    "scripts/launcher-owner.ts",
    "scripts/launch-port.mjs",
    "scripts/select-install-port.mjs",
    "server/execution.ts",
    "server/runtime-owner.ts",
    "shared/updates.ts",
  ]) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    copyFileSync(resolve(file), join(root, file));
  }
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  pkg.scripts.build = "node fixture-build.cjs";
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  writeFileSync(
    join(root, "fixture-build.cjs"),
    `
    const fs = require('node:fs');
    fs.appendFileSync('build-calls', 'build\\n');
    if (process.env.TEST_BUILD_SKIP_OUTPUT !== '1') {
      fs.mkdirSync('dist', {recursive: true});
      const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
      fs.writeFileSync('dist/margin-build.json', JSON.stringify({version}));
      fs.writeFileSync('dist/index.html', 'fixture');
    }
    process.exitCode = Number(process.env.TEST_BUILD_EXIT || 0);
  `,
  );
  // This fixture exercises orchestration, not sandbox security or the UI.
  writeFileSync(
    join(root, "scripts/check-cco.ts"),
    `
    import {writeFileSync} from 'node:fs';
    writeFileSync(${JSON.stringify(join(root, "sandbox-checked"))}, 'checked');
    process.exitCode = Number(process.env.TEST_SANDBOX_EXIT || 0);
  `,
  );
  writeFileSync(
    join(root, "server/gateway.ts"),
    `
    import {createServer} from 'node:http';
    import {listenOnLoopback} from '../scripts/launch-port.mjs';
    const port = Number(process.env.PORT);
    const server = createServer((_,res) => res.end('fixture'));
    await listenOnLoopback(server, port);
    if (process.env.TEST_REJECT_URL) {
      const {DatabaseSync} = await import('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(join(root, ".margin-data/launcher/owner.sqlite"))});
      db.exec("CREATE TRIGGER reject_url BEFORE UPDATE ON owner BEGIN SELECT RAISE(ABORT,'fixture URL write failure'); END;");
      db.close();
    }
    console.log('FIXTURE_READY ' + port);
    if (process.env.TEST_EXIT_AFTER_LISTEN) server.close();
    process.once('SIGTERM', () => server.close(() => process.exit(0)));
  `,
  );
  if (installed) {
    symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "dist/index.html"), "fixture");
    writeFileSync(
      join(root, "dist/margin-build.json"),
      JSON.stringify({ version: pkg.version }),
    );
  }
  const config = join(root, ".margin-data/installation.json");
  const savePort = (port: number) => {
    mkdirSync(dirname(config), { recursive: true });
    writeFileSync(
      config,
      JSON.stringify({ version: 1, port, cookieName: "fixture_cookie" }),
    );
  };
  const env: NodeJS.ProcessEnv = {
    ...cleanEnvironment(),
    NODE_ENV: "production",
  };
  const run = (args: string[] = [], extra: NodeJS.ProcessEnv = {}) =>
    spawnSync("bash", [join(root, "start.sh"), ...args], {
      env: { ...env, TEST_EXIT_AFTER_LISTEN: "1", ...extra },
      encoding: "utf8",
      timeout: 20000,
    });
  return {
    root,
    config,
    savePort,
    env,
    run,
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function running(root: string, port: number, extra: NodeJS.ProcessEnv = {}) {
  const child = spawn(
    "bash",
    [join(root, "start.sh"), "--port", String(port)],
    {
      env: { ...cleanEnvironment(), ...extra },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  const ready = new Promise<boolean>((done, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Launch timed out: ${output}`));
    }, 20000);
    const settled = (result: boolean) => {
      clearTimeout(timer);
      done(result);
    };
    const collect = (data: Buffer) => {
      output += data;
      if (output.includes("FIXTURE_READY")) settled(true);
    };
    child.stdout!.on("data", collect);
    child.stderr!.on("data", collect);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => settled(false));
  });
  return { child, ready, output: () => output };
}
async function stop(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM") {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill(signal);
  await exited;
}

test("start.sh help and bad arguments work without performing a sandbox probe", () => {
  const f = fixture();
  try {
    const help = f.run(["--help"]);
    assert.equal(help.status, 0, help.stdout + help.stderr);
    assert.match(help.stdout, /--port PORT/);
    for (const args of [
      ["--port"],
      ["--port", "abc"],
      ["--port", "65536"],
      ["--unknown"],
    ]) {
      const bad = f.run(args);
      assert.equal(bad.status, 1, bad.stdout + bad.stderr);
      assert.match(bad.stderr, /requires a value|Choose a port|Unknown option/);
    }
    assert.equal(existsSync(join(f.root, "sandbox-checked")), false);
    assert.equal(existsSync(join(f.root, ".margin-data")), false);
  } finally {
    f.close();
  }
});

test("production startup rebuilds changed versions and missing or damaged builds, then skips an up-to-date build", async () => {
  const ports = await occupyPorts(1);
  await ports.close();
  const f = fixture();
  try {
    const expected = JSON.parse(
      readFileSync(join(f.root, "package.json"), "utf8"),
    ).version;
    const buildFile = join(f.root, "dist/margin-build.json");
    const cases = [
      () => writeFileSync(buildFile, '{"version":"0.0.1"}'),
      () => writeFileSync(buildFile, '{"version":"99.0.0"}'),
      () => writeFileSync(buildFile, "broken"),
      () => rmSync(buildFile),
      () => rmSync(join(f.root, "dist/index.html")),
      () => rmSync(join(f.root, "dist"), { recursive: true }),
    ];
    for (const damage of cases) {
      damage();
      const result = f.run(["--port", String(ports.port)]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /Building Margin before startup/);
      assert.match(result.stdout, /FIXTURE_READY/);
      assert.equal(
        JSON.parse(readFileSync(buildFile, "utf8")).version,
        expected,
      );
      assert.equal(
        existsSync(join(f.root, ".margin-data/startup-build-pending")),
        false,
      );
    }
    const built = readFileSync(join(f.root, "build-calls"), "utf8");
    assert.equal(built.trim().split("\n").length, cases.length);
    const next = f.run(["--port", String(ports.port)]);
    assert.equal(next.status, 0, next.stdout + next.stderr);
    assert.doesNotMatch(next.stdout, /Building Margin/);
    assert.equal(readFileSync(join(f.root, "build-calls"), "utf8"), built);
  } finally {
    f.close();
  }
});

test("npm start also rebuilds before launching and a failed build blocks startup until a successful retry", async () => {
  const ports = await occupyPorts(1);
  await ports.close();
  const f = fixture();
  try {
    rmSync(join(f.root, "dist"), { recursive: true });
    const failed = f.run(["--port", String(ports.port)], {
      TEST_BUILD_EXIT: "73",
    });
    assert.equal(failed.status, 1, failed.stdout + failed.stderr);
    assert.match(failed.stderr, /Startup build failed/);
    assert.doesNotMatch(failed.stdout, /FIXTURE_READY/);
    assert.equal(
      existsSync(join(f.root, ".margin-data/startup-build-pending")),
      true,
    );
    claimLauncher(f.root).release();
    // The failed build emitted matching metadata; the marker still forces retry.
    const retried = spawnSync(
      "npm",
      ["start", "--", "--port", String(ports.port)],
      {
        cwd: f.root,
        env: { ...f.env, TEST_EXIT_AFTER_LISTEN: "1" },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(retried.status, 0, retried.stdout + retried.stderr);
    assert.match(retried.stdout, /previous startup build did not finish/);
    assert.match(retried.stdout, /FIXTURE_READY/);
    assert.equal(
      readFileSync(join(f.root, "build-calls"), "utf8"),
      "build\nbuild\n",
    );
  } finally {
    f.close();
  }
});

test("startup rejects a successful build command that leaves no matching output", async () => {
  const ports = await occupyPorts(1);
  await ports.close();
  const f = fixture();
  try {
    rmSync(join(f.root, "dist"), { recursive: true });
    const result = f.run(["--port", String(ports.port)], {
      TEST_BUILD_SKIP_OUTPUT: "1",
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /did not produce a matching app/);
    assert.doesNotMatch(result.stdout, /FIXTURE_READY/);
    claimLauncher(f.root).release();
  } finally {
    f.close();
  }
});

test("help, dry-run, development, and a blocked duplicate launch never rebuild", async () => {
  const ports = await occupyPorts(1);
  await ports.close();
  const f = fixture();
  try {
    rmSync(join(f.root, "dist"), { recursive: true });
    for (const args of [
      ["--help"],
      ["--dry-run"],
      ["--dev", "--port", String(ports.port)],
    ]) {
      const result = f.run(args);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.equal(existsSync(join(f.root, "build-calls")), false);
    }
    const owner = claimLauncher(f.root);
    try {
      const result = f.run(["--port", String(ports.port)]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /already running/);
      assert.equal(existsSync(join(f.root, "build-calls")), false);
    } finally {
      owner.release();
    }
  } finally {
    f.close();
  }
});

test("start.sh applies CLI > PORT > saved port, without changing the saved default", async () => {
  const ports = await occupyPorts(3);
  await ports.close();
  const f = fixture();
  try {
    f.savePort(ports.port);
    const original = readFileSync(f.config, "utf8");
    for (const [args, env, expected] of [
      [[], {}, ports.port],
      [[], { PORT: String(ports.port + 1) }, ports.port + 1],
      [["--port", String(ports.port + 2)], { PORT: "invalid" }, ports.port + 2],
    ] as const) {
      const result = f.run([...args], env);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, new RegExp(`FIXTURE_READY ${expected}`));
      assert.equal(readFileSync(f.config, "utf8"), original);
    }
    assert.equal(existsSync(join(f.root, "sandbox-checked")), true);
  } finally {
    f.close();
  }
});

test(`start.sh collision declines noninteractive before sandbox, and accepts a temporary port: ${terminalMode}`, async () => {
  const ports = await occupyPorts(2);
  const f = fixture();
  try {
    f.savePort(ports.port);
    const original = readFileSync(f.config, "utf8");
    const unattended = f.run();
    assert.equal(unattended.status, 1, unattended.stdout + unattended.stderr);
    assert.match(
      unattended.stderr,
      /No interactive terminal.*bash start.sh --port/,
    );
    assert.equal(existsSync(join(f.root, "sandbox-checked")), false);
    const result = runInTerminal(["bash", join(f.root, "start.sh")], "yes\n", {
      ...f.env,
      TEST_EXIT_AFTER_LISTEN: "1",
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Start Margin there\?/);
    const selected = Number(result.stdout.match(/FIXTURE_READY (\d+)/)?.[1]);
    assert.ok(selected >= ports.port + 2 && selected <= ports.port + 10);
    assert.equal(readFileSync(f.config, "utf8"), original);
  } finally {
    await ports.close();
    f.close();
  }
});

test("sandbox failure releases ownership, exits nonzero, and never starts the gateway", async () => {
  const ports = await occupyPorts(1);
  await ports.close();
  const f = fixture();
  try {
    const result = f.run(["--port", String(ports.port)], {
      TEST_SANDBOX_EXIT: "71",
    });
    assert.equal(result.status, 71, result.stdout + result.stderr);
    assert.match(result.stderr, /Sandbox verification failed/);
    assert.doesNotMatch(result.stdout, /FIXTURE_READY/);
    const owner = claimLauncher(f.root);
    owner.release();
  } finally {
    f.close();
  }
});

test("ownership is canonical across folder aliases and publishes the bound URL", () => {
  const f = fixture();
  const parent = temporaryRoot("alias-");
  const owner = claimLauncher(f.root);
  try {
    const alias = join(parent, "checkout");
    symlinkSync(f.root, alias, "dir");
    assert.throws(() => claimLauncher(alias), /startup in progress/);
    owner.listening(4318);
    assert.throws(() => claimLauncher(alias), /http:\/\/127.0.0.1:4318/);
    owner.release();
    claimLauncher(alias).release();
  } finally {
    owner.release();
    f.close();
    rmSync(parent, { recursive: true, force: true });
  }
});

test("simultaneous same-checkout starts have one winner; different data/port cannot bypass it; SIGKILL recovers", async () => {
  const ports = await occupyPorts(3);
  await ports.close();
  const f = fixture();
  const first = running(f.root, ports.port);
  const second = running(f.root, ports.port + 1);
  let restarted: ReturnType<typeof running> | undefined;
  try {
    const results = await Promise.all([first.ready, second.ready]);
    assert.equal(
      results.filter(Boolean).length,
      1,
      first.output() + second.output(),
    );
    const winner = results[0] ? first : second;
    const loser = results[0] ? second : first;
    assert.match(loser.output(), /already running from this folder/);
    assert.doesNotMatch(loser.output(), /Next available port/);
    const secondData = join(f.root, "another-data-dir");
    const denied = f.run(["--port", String(ports.port + 2)], {
      MARGIN_DATA_DIR: secondData,
    });
    assert.equal(denied.status, 1, denied.stdout + denied.stderr);
    assert.match(denied.stderr, /already running.*http:\/\/127.0.0.1:/);
    assert.equal(existsSync(secondData), false);
    await stop(winner.child, "SIGKILL");
    restarted = running(f.root, ports.port + 2);
    assert.equal(await restarted.ready, true, restarted.output());
    await stop(restarted.child);
    claimLauncher(f.root).release();
  } finally {
    await stop(first.child);
    await stop(second.child);
    if (restarted) await stop(restarted.child);
    f.close();
  }
});

test("a failed URL update after binding does not release a live launcher's ownership", async () => {
  const ports = await occupyPorts(2);
  await ports.close();
  const f = fixture();
  const first = running(f.root, ports.port, { TEST_REJECT_URL: "1" });
  try {
    assert.equal(await first.ready, true, first.output());
    const denied = f.run(["--port", String(ports.port + 1)]);
    assert.equal(denied.status, 1, denied.stdout + denied.stderr);
    assert.match(denied.stderr, /already running from this folder/);
  } finally {
    await stop(first.child);
    f.close();
  }
});

test("separate fresh checkouts can run concurrently", async () => {
  const ports = await occupyPorts(2);
  await ports.close();
  const a = fixture(),
    b = fixture();
  const first = running(a.root, ports.port),
    second = running(b.root, ports.port + 1);
  try {
    assert.deepEqual(
      await Promise.all([first.ready, second.ready]),
      [true, true],
      first.output() + second.output(),
    );
  } finally {
    await stop(first.child);
    await stop(second.child);
    a.close();
    b.close();
  }
});

test(`installer checks ports before npm; accepted fallback is saved and --start uses it: ${terminalMode}`, async () => {
  const ports = await occupyPorts(2);
  const f = fixture(false);
  try {
    execFileSync("git", ["init", "-q", f.root]);
    const bin = join(f.root, "bin");
    mkdirSync(bin);
    // Stub build/platform steps only; the shell, port probe, config write, and
    // handoff into the real launcher code run unchanged in an isolated copy.
    writeFileSync(join(bin, "uname"), "#!/bin/sh\necho Darwin\n", {
      mode: 0o755,
    });
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/sh\necho "$*" >> npm-calls\nif [ "$1" = ci ]; then ln -s '${resolve("node_modules").replaceAll("'", "'\\''")}' node_modules; fi\nif [ "$1" = run ] && [ "$2" = build ]; then node fixture-build.cjs; fi\n`,
      { mode: 0o755 },
    );
    mkdirSync(join(f.root, "vendor/cco"), { recursive: true });
    for (const name of ["cco", "sandbox"])
      writeFileSync(join(f.root, "vendor/cco", name), "#!/bin/sh\nexit 99\n", {
        mode: 0o755,
      });
    const env = {
      ...f.env,
      PATH: `${bin}:${f.env.PATH}`,
      TEST_EXIT_AFTER_LISTEN: "1",
    };
    const args = [
      "bash",
      join(f.root, "install.sh"),
      "--port",
      String(ports.port),
      "--start",
    ];
    const unattended = spawnSync(args[0], args.slice(1), {
      env,
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(unattended.status, 1, unattended.stdout + unattended.stderr);
    assert.match(
      unattended.stderr,
      /No interactive terminal.*bash install.sh --port/,
    );
    assert.equal(existsSync(join(f.root, "npm-calls")), false);
    assert.equal(existsSync(f.config), false);
    const declined = runInTerminal(args, "n\n", env);
    assert.equal(declined.status, 1, declined.stdout + declined.stderr);
    assert.equal(existsSync(join(f.root, "npm-calls")), false);
    const accepted = runInTerminal(args, "y\n", env);
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    const config = JSON.parse(readFileSync(f.config, "utf8"));
    assert.ok(config.port >= ports.port + 2 && config.port <= ports.port + 10);
    assert.match(accepted.stdout, new RegExp(`FIXTURE_READY ${config.port}`));
    assert.match(
      readFileSync(join(f.root, "npm-calls"), "utf8"),
      /ci --include=dev --ignore-scripts\nrun build/,
    );
    assert.equal(existsSync(join(f.root, "sandbox-checked")), true);
  } finally {
    await ports.close();
    f.close();
  }
});
