import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PluginInfo } from "../shared/customization.ts";

export function pluginPreferences(root: string): {
  version: 1;
  disabled: string[];
} {
  const path = join(root, "margin.plugins.json");
  if (!existsSync(path)) return { version: 1, disabled: [] };
  const value = JSON.parse(readFileSync(path, "utf8")) as {
    version?: number;
    disabled?: unknown;
  };
  if (
    value.version !== 1 ||
    !Array.isArray(value.disabled) ||
    value.disabled.some(
      (id) => typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id),
    )
  )
    throw new Error(
      "Invalid margin.plugins.json. Restore a checkpoint or correct its disabled plugin list.",
    );
  return { version: 1, disabled: value.disabled as string[] };
}
export function pluginCatalog(root: string): PluginInfo[] {
  const path = join(root, "plugins");
  if (!existsSync(path)) return [];
  const disabled = new Set(pluginPreferences(root).disabled);
  return readdirSync(path, { withFileTypes: true })
    .filter((x) => x.isDirectory() && /^[a-z][a-z0-9-]*$/.test(x.name))
    .flatMap((dir) => {
      const directory = join(path, dir.name),
        server = existsSync(join(directory, "server.ts")),
        browser = existsSync(join(directory, "client.tsx"));
      if (!server && !browser) return [];
      let name = dir.name
          .split("-")
          .map((x) => x[0].toUpperCase() + x.slice(1))
          .join(" "),
        description = "Local Margin plugin";
      const manifest = join(directory, "plugin.json");
      if (existsSync(manifest)) {
        try {
          const m = JSON.parse(readFileSync(manifest, "utf8"));
          if (typeof m.name === "string") name = m.name;
          if (typeof m.description === "string") description = m.description;
        } catch {
          /* A missing display manifest does not execute or invalidate plugin code. */
        }
      } else if (existsSync(join(directory, "README.md"))) {
        const paragraph = readFileSync(join(directory, "README.md"), "utf8")
          .split(/\n\s*\n/)
          .find((x) => x.trim() && !x.trim().startsWith("#"));
        if (paragraph)
          description = paragraph.replace(/\s+/g, " ").slice(0, 260);
      }
      return [
        {
          id: dir.name,
          name,
          description,
          directory,
          server,
          browser,
          enabled: !disabled.has(dir.name),
          active: false,
        },
      ];
    });
}
export function setPluginEnabled(root: string, id: string, enabled: boolean) {
  if (!pluginCatalog(root).some((p) => p.id === id))
    throw new Error("Plugin not found.");
  const preferences = pluginPreferences(root),
    disabled = new Set(preferences.disabled);
  if (enabled) disabled.delete(id);
  else disabled.add(id);
  const path = join(root, "margin.plugins.json"),
    tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(
    tmp,
    JSON.stringify({ version: 1, disabled: [...disabled].sort() }, null, 2) +
      "\n",
  );
  renameSync(tmp, path);
}
