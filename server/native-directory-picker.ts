import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute, join } from "node:path";

type Runner = (
  command: string,
  args: string[],
  signal: AbortSignal,
) => Promise<string>;
const execute = promisify(execFile);
const run: Runner = async (command, args, signal) =>
  (
    await execute(command, args, {
      signal,
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    })
  ).stdout;

export class NativeDirectoryPicker {
  private active?: AbortController;
  constructor(
    private appRoot: string,
    private runner: Runner = run,
    private platform: string = process.platform,
  ) {}
  async choose(
    initialDirectory: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    if (this.active)
      throw new Error(
        "A folder dialog is already open. Finish or cancel it first.",
      );
    if (this.platform !== "darwin")
      throw new Error(
        "The native workspace dialog currently supports macOS. You can open a workspace with npm start -- --project /path/to/project on this platform.",
      );
    const controller = new AbortController();
    this.active = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const output = await this.runner(
        "/usr/bin/osascript",
        [
          "-l",
          "JavaScript",
          join(this.appRoot, "scripts", "choose-workspace.jxa.js"),
          initialDirectory,
        ],
        controller.signal,
      );
      const value: unknown = JSON.parse(output.trim());
      if (!value || typeof value !== "object" || !("path" in value))
        throw new Error("The folder dialog returned an invalid result.");
      const path = value.path;
      if (path === null) return null;
      if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))
        throw new Error(
          "The folder dialog did not return an absolute folder path.",
        );
      return path;
    } finally {
      signal?.removeEventListener("abort", abort);
      this.active = undefined;
    }
  }
  close() {
    this.active?.abort();
  }
}
