import { createServer, type Server } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listenOnLoopback } from "../scripts/launch-port.mjs";

export async function occupyPorts(count: number) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const port = 20000 + Math.floor(Math.random() * 30000);
    const servers: Server[] = [];
    const close = () =>
      Promise.all(
        servers.map((s) => new Promise<void>((done) => s.close(() => done()))),
      );
    try {
      for (let i = 0; i < count; i++) {
        const server = createServer();
        servers.push(server);
        await listenOnLoopback(server, port + i);
      }
      return { port, close };
    } catch {
      await close();
    }
  }
  throw new Error("Could not allocate consecutive fixture ports");
}

// Prefer a real PTY, but retain readline/entrypoint coverage if the sandbox
// blocks PTYs. Callers label the simulated fallback in the test output.
export const hasTerminal =
  spawnSync("python3", [
    "-c",
    "import os,pty; a,b=pty.openpty(); os.close(a); os.close(b)",
  ]).status === 0;
export const terminalMode = hasTerminal
  ? "real PTY"
  : "simulated TTY (PTY unavailable)";
export function runInTerminal(
  args: string[],
  answer: string,
  env: NodeJS.ProcessEnv,
) {
  if (!hasTerminal) {
    const preload = pathToFileURL(
      resolve("tests/terminal-input-fixture.mjs"),
    ).href;
    const result = spawnSync(args[0], args.slice(1), {
      env: {
        ...env,
        NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} --import=${preload}`,
      },
      input: answer.replaceAll("\x04", ""),
      encoding: "utf8",
      timeout: 20000,
    });
    return { ...result, stdout: result.stderr + "\n" + result.stdout };
  }
  return spawnSync(
    "python3",
    [
      "-c",
      `
import os, pty, select, subprocess, sys
master, slave = pty.openpty()
child = subprocess.Popen(sys.argv[2:], stdin=slave, stdout=slave, stderr=slave)
os.close(slave)
sent = False
output = b''
while True:
    readable, _, _ = select.select([master], [], [], 0.1)
    if readable:
        try: data = os.read(master, 65536)
        except OSError: break
        if not data: break
        sys.stdout.buffer.write(data); sys.stdout.buffer.flush()
        output += data
        if not sent and b'[y/N]' in output:
            os.write(master, sys.argv[1].encode()); sent = True
    elif child.poll() is not None: break
os.close(master)
sys.exit(child.wait())
`,
      answer,
      ...args,
    ],
    { env, encoding: "utf8", timeout: 20000 },
  );
}

export function cleanEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !key.startsWith("MARGIN_") &&
        key !== "PORT" &&
        key !== "PI_CODING_AGENT_DIR",
    ),
  );
}

export function temporaryRoot(prefix: string) {
  const parent = resolve(".margin-data/temporary/launch-tests");
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}
