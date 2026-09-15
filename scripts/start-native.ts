import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configureInstallation } from "./installation.ts";

if (process.env.MARGIN_WORKER_TOKEN || process.env.MARGIN_CCO_INFO)
  throw new Error("Run an explicit native launch outside an existing Margin worker.");
configureInstallation(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
await import("../server/index.ts");
