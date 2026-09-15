import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export function cloneInstallationSource(sourceInput, destinationInput) {
  const source = realpathSync(sourceInput);
  const gitDirectory = resolve(source, ".git");
  if (!existsSync(gitDirectory) || !lstatSync(gitDirectory).isDirectory() ||
      lstatSync(gitDirectory).isSymbolicLink() ||
      existsSync(resolve(gitDirectory, "objects/info/alternates")))
    throw new Error("Use a standalone Git clone, not a linked worktree or shared object store.");
  const trackedWorkspaceFiles = execFileSync("git", ["-C", source, "ls-files", "-z", "--", "workspaces"], { encoding: "utf8" })
    .split("\0").filter(Boolean);
  if (trackedWorkspaceFiles.length)
    throw new Error("Workspace files are tracked by Margin. Untrack them before creating a fresh source copy; no files were changed.");
  const destination = resolve(destinationInput);
  const rel = relative(source, destination);
  if (rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel)))
    throw new Error("Choose a destination outside the source folder.");
  if (existsSync(destination) || (() => { try { lstatSync(destination); return true; } catch { return false; } })())
    throw new Error("Destination already exists. Nothing was overwritten; choose a new folder.");
  let ancestor = dirname(destination);
  const pending = [];
  while (!existsSync(ancestor)) {
    try {
      lstatSync(ancestor);
      throw new Error("Destination parent contains a broken symbolic link.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    pending.unshift(basename(ancestor));
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("Cannot resolve destination parent.");
    ancestor = parent;
  }
  const parent = resolve(realpathSync(ancestor), ...pending);
  const canonicalRel = relative(source, parent);
  if (canonicalRel === "" || (!canonicalRel.startsWith(".." + sep) && canonicalRel !== ".." && !isAbsolute(canonicalRel)))
    throw new Error("Destination resolves inside the source folder.");
  mkdirSync(dirname(destination), { recursive: true });
  mkdirSync(destination, { mode: 0o700 });
  const omit = new Set([
    ".margin-data", "node_modules", "dist", "workspaces", "test-results",
    "playwright-report", ".DS_Store", ".buildx", "docker-trial-backup",
    "preparation.json", "docker-reference-workbench",
  ]);
  for (const entry of readdirSync(source)) {
    if (omit.has(entry)) continue;
    if (entry.startsWith(".env") && entry !== ".env.example") continue;
    cpSync(resolve(source, entry), resolve(destination, entry), {
      recursive: true, dereference: false, verbatimSymlinks: true,
      force: false, errorOnExist: true,
      filter: entry === ".git" ? undefined : (path) => {
        const name = basename(path);
        return !omit.has(name) && (!name.startsWith(".env") || name === ".env.example");
      },
    });
  }
  return realpathSync(destination);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , source, destination] = process.argv;
    if (!source || !destination) throw new Error("Usage: node clone-installation-source.mjs SOURCE NEW_DESTINATION");
    console.log(cloneInstallationSource(source, destination));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
