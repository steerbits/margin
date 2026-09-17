import { createServer } from "node:net";
import { createInterface } from "node:readline/promises";

export const DEFAULT_PORT = 4317;
export const MAX_PORT_FALLBACKS = 10;

export function parsePort(value) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isInteger(Number(value)) ||
    Number(value) < 1024 ||
    Number(value) > 65535
  )
    throw new Error("Choose a port between 1024 and 65535.");
  return Number(value);
}

// Probe the same interface as the gateway. A successful probe is not a
// reservation: the real listener must still handle bind errors.
export async function portAvailable(port) {
  const server = createServer();
  return new Promise((accept, reject) => {
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE") accept(false);
      else reject(new Error(`Cannot check port ${port}: ${error.message}`));
    });
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => (error ? reject(error) : accept(true)));
    });
  });
}

export async function confirmPort(question) {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stderr,
  });
  // EOF and Ctrl-C both mean no; neither should leave a hung launch behind.
  const abort = new AbortController();
  terminal.once("close", () => abort.abort());
  terminal.once("SIGINT", () => abort.abort());
  try {
    const answer = await terminal.question(`${question} [y/N] `, {
      signal: abort.signal,
    });
    return /^(y|yes)$/i.test(answer.trim());
  } catch (error) {
    if (abort.signal.aborted) return false;
    throw error;
  } finally {
    terminal.close();
  }
}

export async function selectPort(
  requested,
  {
    interactive = !!process.stdin.isTTY && !!process.stderr.isTTY,
    confirm = confirmPort,
    available = portAvailable,
    report = (message) => console.error(message),
    action = "Start Margin there?",
    command = "bash start.sh",
  } = {},
) {
  const port = parsePort(requested);
  if (await available(port)) return port;
  report(`Port ${port} is unavailable.`);
  const last = Math.min(port + MAX_PORT_FALLBACKS, 65535);
  for (let next = port + 1; next <= last; next++) {
    if (!(await available(next))) continue;
    const suggestion = `${command} --port ${next}`;
    if (!interactive)
      throw new Error(
        `Next available port: ${next}. No interactive terminal; run: ${suggestion}`,
      );
    if (!(await confirm(`Next available port: ${next}. ${action}`)))
      throw new Error(
        `Not started. To choose a port manually, run: ${suggestion}`,
      );
    return next;
  }
  throw new Error(
    `No available port in ${port}–${last} (at most ${MAX_PORT_FALLBACKS} higher ports checked). Choose a port manually: ${command} --port PORT`,
  );
}

export function listenOnLoopback(server, port) {
  return new Promise((accept, reject) => {
    const failed = (error) => {
      server.off("listening", ready);
      reject(
        new Error(
          error.code === "EADDRINUSE"
            ? `Port ${port} became unavailable before Margin could start. Retry with: bash start.sh --port PORT`
            : `Could not start Margin on port ${port}: ${error.message}`,
        ),
      );
    };
    const ready = () => {
      server.off("error", failed);
      accept();
    };
    server.once("error", failed);
    server.once("listening", ready);
    server.listen(port, "127.0.0.1");
  });
}
