import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Plugin } from "vite";
import { validVersion } from "../shared/updates.ts";

export function buildIdentity(root: string) {
  const version: unknown = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).version;
  if (!validVersion(version))
    throw new Error("package.json must have a stable x.y.z version.");
  let commit: string | null = null;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    /* Uncommitted fixture or source archive. */
  }
  return { version, commit };
}
export function buildIdentityPlugin(
  identity: ReturnType<typeof buildIdentity>,
): Plugin {
  return {
    name: "margin-build-identity",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "margin-build.json",
        source: JSON.stringify(identity) + "\n",
      });
    },
  };
}
