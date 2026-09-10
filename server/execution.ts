import { relative, isAbsolute, resolve } from "node:path";
import type { ExecutionInfo } from "../shared/types.ts";

export function executionInfo(
  raw = process.env.MARGIN_CCO_INFO,
): ExecutionInfo {
  if (!raw) return { mode: "native" };
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (
    value.mode !== "cco" ||
    typeof value.projectRoot !== "string" ||
    !Array.isArray(value.writablePaths) ||
    value.writablePaths.some((p) => typeof p !== "string")
  ) {
    throw new Error(
      "Invalid cco launch information. Start Margin using npm start.",
    );
  }
  return {
    mode: "cco",
    projectRoot: value.projectRoot,
    writablePaths: value.writablePaths as string[],
  };
}

// Describes explicit launch grants; the OS policy remains the enforcement mechanism.
export function withinPath(path: string, parent: string): boolean {
  const part = relative(resolve(parent), resolve(path));
  return (
    part === "" ||
    (!part.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      part !== ".." &&
      !isAbsolute(part))
  );
}
