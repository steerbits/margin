import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { parseLaunchOptions } from "./start-cco.ts";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const options = parseLaunchOptions(process.argv.slice(2), appRoot);
if (options.help) {
  console.log(
    "Usage: npm start -- [--project FOLDER] [--add-dir FOLDER] [--dev]\n\nOpens Margin's local launcher. Choose any writable folder in the browser; each workspace gets its own cco worker. --project selects an initial workspace; --add-dir pre-registers more workspaces. New workspace opens the macOS folder dialog, including New Folder. MARGIN_WORKSPACE_PARENT can set its initial location.",
  );
} else if (options.dryRun) {
  console.log(
    JSON.stringify(
      {
        launcher: "server/gateway.ts",
        sandbox: "one cco worker per workspace",
        initialWorkspace: options.project,
      },
      null,
      2,
    ),
  );
} else {
  if (process.env.MARGIN_CCO_INFO || process.env.MARGIN_WORKER_TOKEN)
    throw new Error(
      "Start the Margin launcher from a normal Terminal, outside an existing Margin worker.",
    );
  process.env.NODE_ENV = options.dev ? "development" : "production";
  process.env.MARGIN_INITIAL_PROJECTS = JSON.stringify(
    await Promise.all(
      [options.project, ...options.extra].map((p) =>
        realpath(resolve(p.replace(/^~(?=\/|$)/, homedir()))),
      ),
    ),
  );
  await import("../server/gateway.ts");
}
