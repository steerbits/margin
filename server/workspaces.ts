import { mkdir, realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Project } from "../shared/types.ts";
export async function createWorkspace(
  parent: string,
  name: string,
): Promise<Project> {
  const clean = name.trim();
  if (
    !clean ||
    clean === "." ||
    clean === ".." ||
    /[\\/\0]/.test(clean) ||
    clean.startsWith(".")
  )
    throw new Error("Use a workspace name without slashes or a leading dot.");
  const root = await realpath(resolve(parent));
  if (!(await stat(root)).isDirectory())
    throw new Error("Choose a parent folder.");
  const path = join(root, clean);
  await mkdir(path); // EEXIST must never silently reuse or overwrite a folder.
  return { id: randomUUID(), name: clean, path: await realpath(path) };
}
