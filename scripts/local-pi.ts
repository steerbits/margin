import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureInstallation } from "./installation.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
configureInstallation(appRoot);
const child = spawn(
  process.execPath,
  [
    join(appRoot, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js"),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: process.env },
);
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
