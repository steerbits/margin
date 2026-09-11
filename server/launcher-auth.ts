import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Only hashes persist. A worker's normal read access cannot turn the stored
// hashes into a capability to ask the launcher to open a different workspace.
export function launcherAuth(dataDir: string) {
  const path = join(dataDir, "launcher-auth.json");
  const hash = (value: string) =>
    createHash("sha256").update(value).digest("hex");
  const previous: unknown = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : [];
  if (
    !Array.isArray(previous) ||
    previous.some((v) => typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
  )
    throw new Error("Invalid launcher authentication file.");
  const token = randomBytes(32).toString("hex");
  const hashes = new Set<string>([...previous, hash(token)]);
  const temp = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temp, JSON.stringify([...hashes]), { mode: 0o600 });
  renameSync(temp, path);
  return {
    token,
    accepts: (value: string) => value.length === 64 && hashes.has(hash(value)),
  };
}
