import { readdir, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { ServerPlugin, PluginContext, PluginEvent } from "./plugin-api.ts";

export async function loadPlugins(
  root: string,
  options: {
    disabled?: Set<string>;
    onError?: (id: string, error: unknown) => void;
    onLoaded?: (folder: string, id: string) => void;
  } = {},
): Promise<ServerPlugin[]> {
  const plugins: ServerPlugin[] = [];
  let dirs;
  try {
    dirs = await readdir(root, { withFileTypes: true });
  } catch {
    return plugins;
  }
  for (const d of dirs.filter((x) => x.isDirectory())) {
    if (options.disabled?.has(d.name)) continue;
    const entry = join(root, d.name, "server.ts");
    try {
      await access(entry);
    } catch {
      continue;
    }
    try {
      const p = (await import(pathToFileURL(entry).href))
        .default as ServerPlugin;
      if (
        p.apiVersion !== 1 ||
        !/^[a-z][a-z0-9-]*$/.test(p.id) ||
        plugins.some((x) => x.id === p.id)
      )
        throw new Error(`Invalid or duplicate plugin: ${d.name}`);
      plugins.push(p);
      options.onLoaded?.(d.name, p.id);
    } catch (error) {
      if (options.onError) options.onError(d.name, error);
      else throw error;
    }
  }
  return plugins;
}
export function dispatchPluginEvent(
  plugins: ServerPlugin[],
  event: PluginEvent,
  context: (id: string) => PluginContext,
) {
  for (const p of plugins)
    if (p.onEvent)
      Promise.resolve()
        .then(() => p.onEvent!(event, context(p.id)))
        .catch((e) =>
          context(p.id).notify(
            `Plugin ${p.id}: ${e instanceof Error ? e.message : String(e)}`,
          ),
        );
}
