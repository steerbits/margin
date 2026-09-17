import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseLaunchOptions } from "../scripts/start-cco.ts";
import {
  parsePort,
  portAvailable,
  selectPort,
  listenOnLoopback,
} from "../scripts/launch-port.mjs";

import {
  occupyPorts,
  terminalMode,
  runInTerminal,
  cleanEnvironment,
  temporaryRoot,
} from "./launch-fixtures.ts";

test("--port accepts only decimal ports in the supported range", () => {
  assert.equal(parseLaunchOptions(["--port", "4318"], "/app").port, 4318);
  assert.equal(parsePort("65535"), 65535);
  assert.equal(parsePort("01024"), 1024);
  for (const value of [
    "0",
    "1023",
    "65536",
    "4.3",
    "4e3",
    "0x10ff",
    " 4317",
    "NaN",
    "",
    "abc",
  ])
    assert.throws(() => parsePort(value), /between 1024 and 65535/);
  assert.throws(
    () => parseLaunchOptions(["--port"], "/app"),
    /requires a value/,
  );
  assert.throws(
    () => parseLaunchOptions(["--port", "--dev"], "/app"),
    /requires a value/,
  );
});

test("real occupied consecutive ports are skipped and fallback needs consent", async () => {
  const f = await occupyPorts(3);
  try {
    assert.equal(await portAvailable(f.port), false);
    const checked: number[] = [];
    const common = {
      interactive: true,
      report() {},
      available: async (port: number) => {
        checked.push(port);
        return portAvailable(port);
      },
    };
    const selected = await selectPort(f.port, {
      ...common,
      confirm: async (question) => {
        assert.match(question, /Start Margin there\?/);
        return true;
      },
    });
    assert.ok(selected >= f.port + 3 && selected <= f.port + 10);
    assert.deepEqual(
      checked,
      Array.from({ length: selected - f.port + 1 }, (_, i) => f.port + i),
    );
    assert.equal(
      await portAvailable(selected),
      true,
      "probe releases the port",
    );
    await assert.rejects(
      selectPort(f.port, { ...common, confirm: async () => false }),
      /Not started/,
    );
    await assert.rejects(
      selectPort(f.port, {
        interactive: false,
        report() {},
        confirm: async () => {
          assert.fail("must not prompt without a terminal");
        },
      }),
      /No interactive terminal; run: bash start.sh --port \d+/,
    );
  } finally {
    await f.close();
  }
});

test("a free requested port does not prompt or search", async () => {
  assert.equal(
    await selectPort(4317, {
      available: async (port) => {
        assert.equal(port, 4317);
        return true;
      },
      confirm: async () => assert.fail("unexpected prompt"),
    }),
    4317,
  );
});

test("search stops after ten higher ports and never wraps past 65535", async () => {
  for (const [first, expected] of [
    [4317, 11],
    [65533, 3],
    [65535, 1],
  ]) {
    const checked: number[] = [];
    await assert.rejects(
      selectPort(first, {
        report() {},
        available: async (port) => {
          checked.push(port);
          return false;
        },
      }),
      /No available port.*--port PORT/,
    );
    assert.deepEqual(
      checked,
      Array.from({ length: expected }, (_, i) => first + i),
    );
  }
  assert.equal(
    await selectPort(4317, {
      report() {},
      interactive: true,
      available: async (port) => port === 4327,
      confirm: async () => true,
    }),
    4327,
    "the tenth higher port is included",
  );
});

test("unexpected probe errors are reported rather than treated as collisions", async () => {
  await assert.rejects(
    selectPort(4317, {
      available: async () => {
        throw new Error("permission denied");
      },
      confirm: async () => assert.fail("unexpected prompt"),
    }),
    /permission denied/,
  );
});

test("a real bind race fails explicitly and never reports a successful listener", async () => {
  const f = await occupyPorts(1);
  const server = createServer();
  try {
    await assert.rejects(
      listenOnLoopback(server, f.port),
      /became unavailable.*--port PORT/,
    );
    assert.equal(server.listening, false);
  } finally {
    server.close();
    await f.close();
  }
});

test(`installer CLI confirmation accepts yes, declines no, and cancels EOF: ${terminalMode}`, async () => {
  const f = await occupyPorts(1);
  try {
    for (const [answer, success] of [
      ["y\n", true],
      ["n\n", false],
      ["\x04", false],
    ] as const) {
      const result = runInTerminal(
        [
          process.execPath,
          resolve("scripts/select-install-port.mjs"),
          String(f.port),
          "--start",
        ],
        answer,
        cleanEnvironment(),
      );
      assert.equal(
        result.status,
        success ? 0 : 1,
        result.stdout + result.stderr,
      );
      assert.match(
        result.stdout,
        /Use it for this installation and start Margin there\?/,
      );
      assert.match(result.stdout, success ? /\r?\n\d+\r?\n/ : /Not started/);
    }
  } finally {
    await f.close();
  }
});

test("real gateway bind failure exits nonzero without printing a connection link", async () => {
  const f = await occupyPorts(1);
  const root = temporaryRoot("gateway-error-");
  try {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        resolve("node_modules/tsx/dist/loader.mjs"),
        resolve("server/gateway.ts"),
      ],
      {
        env: {
          ...cleanEnvironment(),
          PORT: String(f.port),
          MARGIN_DATA_DIR: root,
          PI_CODING_AGENT_DIR: join(root, "pi"),
          NODE_ENV: "production",
        },
        encoding: "utf8",
        timeout: 20000,
      },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /became unavailable.*--port PORT/);
    assert.doesNotMatch(result.stdout, /Margin: http|Connect this browser/);
  } finally {
    await f.close();
    rmSync(root, { recursive: true, force: true });
  }
});
