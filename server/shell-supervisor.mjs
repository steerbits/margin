// One short-lived guardian per active Bash call. IPC loss means the SDK host
// died: kill this entire process group, including the ordinary shell children.
// This file intentionally uses only Node built-ins and does not load Pi.
import { spawn } from "node:child_process";
let child;
let started = false,
  completed = false;
const terminate = () => {
  if (process.platform !== "win32") {
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      process.exit(1);
    }
  } else {
    child?.kill("SIGKILL");
    process.exit(1);
  }
};
process.on("disconnect", terminate);
process.on("SIGTERM", terminate);
process.on("SIGINT", terminate);
process.on("message", ({ command, cwd, env, shell, release }) => {
  if (release && completed) process.exit(0);
  if (started || !process.connected) return;
  started = true;
  child = spawn(shell, ["-c", command], {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.once("error", () => {
    completed = true;
    process.send?.({ error: "Could not start the configured shell." });
  });
  child.once("exit", (code) => {
    completed = true;
    process.send?.({ code });
    // Stay alive until the host has drained tool output and acknowledges
    // release. IPC loss still kills the command group throughout that window.
    // Intentionally launched quiet background services retain their existing
    // behavior after a completed tool (they are not resumed/replayed here).
  });
});
// An orphan before the command arrives must not become an idle leaked guardian.
if (!process.connected) terminate();
