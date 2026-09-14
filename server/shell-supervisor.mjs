// One short-lived guardian per active Bash call. IPC loss means the SDK host
// died: kill this entire process group, including the ordinary shell children.
// This file intentionally uses only Node built-ins and does not load Pi.
import { spawn } from "node:child_process";
let child;
let started = false;
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
process.once("message", ({ command, cwd, env, shell }) => {
  if (started || !process.connected) return;
  started = true;
  child = spawn(shell, ["-c", command], {
    cwd,
    env,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.once("error", () => {
    process.send?.({ error: "Could not start the configured shell." });
    process.exitCode = 1;
    setTimeout(() => process.exit(1), 100);
  });
  child.once("exit", (code) => {
    process.send?.({ code });
    // Allow already-written foreground output to drain. Deliberately launched
    // background services retain their existing behavior after a completed tool.
    setTimeout(() => process.exit(0), 100);
  });
});
// An orphan before the command arrives must not become an idle leaked guardian.
if (!process.connected) terminate();
