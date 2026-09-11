import type { BrowserPlugin } from "./plugin-api.ts";
const modules = import.meta.glob<{ default: BrowserPlugin }>(
  "../plugins/*/client.tsx",
);
const fixtures = import.meta.env.MARGIN_TEST_MODE
  ? import.meta.glob<{ default: BrowserPlugin }>(
      "../tests/plugins/*/client.tsx",
    )
  : {};
export const browserPlugins: BrowserPlugin[] = [];
let loadedKey: string | undefined;
export async function loadBrowserPlugins(activeFolders?: string[]) {
  const key = JSON.stringify(activeFolders ?? null);
  if (key === loadedKey) return [];
  const next: BrowserPlugin[] = [],
    errors: string[] = [];
  for (const [path, load] of Object.entries({ ...modules, ...fixtures })) {
    const folder = path.split("/").at(-2)!;
    if (activeFolders && !activeFolders.includes(folder)) continue;
    try {
      const p = (await load()).default;
      if (p.apiVersion !== 1 || next.some((x) => x.id === p.id))
        throw new Error("Incompatible or duplicate plugin");
      next.push(p);
    } catch (error) {
      errors.push(
        `${folder}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  browserPlugins.splice(0, browserPlugins.length, ...next);
  loadedKey = key;
  return errors;
}
