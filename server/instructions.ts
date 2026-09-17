import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  constants,
  closeSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Express, Request, RequestHandler } from "express";
import { z } from "zod";
import {
  MAX_INSTRUCTION_BYTES,
  type InstructionsView,
  type InstructionsSave,
} from "../shared/instructions.ts";

// Keep aligned with the pinned Pi context discovery order. Never silently
// introduce AGENTS.md over an existing alternate context file.
export const contextFilenames = [
  "AGENTS.override.md",
  "AGENTS.md",
  "AGENTS.MD",
  "CLAUDE.md",
  "CLAUDE.MD",
];
export class InstructionsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
function absent(error: unknown) {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}
export function optionalStat(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
}
export function readInstructionText(path: string) {
  // Fail closed rather than replacing invalid UTF-8 or silently skipping an
  // unreadable file as Pi's best-effort CLI discovery can do.
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      readFileSync(path),
    );
  } catch (error) {
    throw new InstructionsError(
      `Couldn't read ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
function revision(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function readInstructions(directory: string): InstructionsView {
  const root = realpathSync(directory);
  const path = join(root, "AGENTS.md");
  let info: ReturnType<typeof lstatSync> | undefined;
  try {
    info = lstatSync(path);
  } catch (error) {
    if (!absent(error)) throw error;
  }
  const names = new Set(readdirSync(root));
  const effectivePath = contextFilenames
    .filter((name) => names.has(name))
    .map((name) => join(root, name))
    .find((candidate) => optionalStat(candidate)?.isFile());
  let blockedReason: string | undefined;
  if (info && (!info.isFile() || info.nlink > 1))
    blockedReason =
      "AGENTS.md is a link or is not a regular file. Edit it outside Margin; this editor will not replace it.";
  else if (info && info.size > MAX_INSTRUCTION_BYTES)
    blockedReason =
      "This file exceeds the editor's 256 KB limit. Edit it outside Margin.";
  else if (effectivePath && effectivePath !== path)
    blockedReason = effectivePath.endsWith("AGENTS.override.md")
      ? `Pi uses ${effectivePath}. AGENTS.md would be ignored. Resolve this alternate file outside Margin before editing here.`
      : `Pi uses ${effectivePath}. Creating AGENTS.md would replace its contribution. Resolve this alternate file outside Margin before editing here.`;
  if (info?.isFile() && !blockedReason) {
    try {
      accessSync(path, constants.W_OK);
    } catch {
      blockedReason =
        "AGENTS.md is read-only. Change its permissions outside Margin before editing here.";
    }
  }
  const content =
    info?.isFile() && info.size <= MAX_INSTRUCTION_BYTES
      ? readInstructionText(path)
      : "";
  return {
    path,
    exists: !!info,
    content,
    effectivePath,
    blockedReason,
    revision: revision([
      !!info,
      content,
      info?.ino,
      info?.mtimeMs,
      info?.ctimeMs,
      effectivePath,
      blockedReason,
    ]),
  };
}

// Each canonical target has one owning server (global: gateway; local: its
// workspace worker). Synchronous compare-and-commit serializes browser saves.
// Rename is atomic; the second comparison also catches external edits during
// preparation. External programs don't participate in a filesystem transaction.
export function saveInstructions(
  directory: string,
  input: InstructionsSave,
  global = false,
) {
  if (Buffer.from(input.content, "utf8").toString("utf8") !== input.content)
    throw new InstructionsError(
      "Instructions must contain valid Unicode text.",
    );
  if (Buffer.byteLength(input.content, "utf8") > MAX_INSTRUCTION_BYTES)
    throw new InstructionsError(
      "Instructions exceed the editor's 256 KB limit.",
      413,
    );
  const before = readInstructions(directory);
  if (before.blockedReason)
    throw new InstructionsError(before.blockedReason, 409);
  if (before.revision !== input.revision)
    throw new InstructionsError(
      "The file changed since you opened it. Copy your draft, then reload the saved file before editing again.",
      409,
    );
  if (before.content === input.content) return before;
  const temporary = join(
    realpathSync(directory),
    `.AGENTS.md.margin-${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  let created = false;
  try {
    const mode = before.exists
      ? statSync(before.path).mode & 0o777
      : global
        ? 0o600
        : 0o644;
    descriptor = openSync(temporary, "wx", mode);
    created = true;
    writeFileSync(descriptor, input.content, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (readInstructions(directory).revision !== before.revision)
      throw new InstructionsError(
        "The file changed during saving. Your draft has not overwritten it. Reload the saved file before editing again.",
        409,
      );
    renameSync(temporary, before.path);
    return readInstructions(directory);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      if (created) unlinkSync(temporary);
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
}

export function installInstructionsRoute(
  app: Express,
  route: string,
  directory: (req: Request) => string,
  global = false,
) {
  const handle =
    (save: boolean): RequestHandler =>
    (req, res) => {
      try {
        const root = directory(req);
        const value = save
          ? saveInstructions(
              root,
              z
                .object({
                  content: z.string().max(MAX_INSTRUCTION_BYTES),
                  revision: z.string().regex(/^[a-f0-9]{64}$/),
                })
                .strict()
                .parse(req.body),
              global,
            )
          : readInstructions(root);
        res.json(value);
      } catch (error) {
        res
          .status(error instanceof InstructionsError ? error.status : 400)
          .json({
            error: error instanceof Error ? error.message : String(error),
          });
      }
    };
  app.get(route, handle(false));
  app.put(route, handle(true));
}
