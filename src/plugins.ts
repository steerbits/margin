import type { BrowserPlugin } from "./plugin-api.ts";
const modules = import.meta.glob<{ default: BrowserPlugin }>(
  "../plugins/*/client.tsx",
  { eager: true },
);
const fixtures = import.meta.env.MARGIN_TEST_MODE
  ? import.meta.glob<{ default: BrowserPlugin }>(
      "../tests/plugins/*/client.tsx",
      { eager: true },
    )
  : {};
export const browserPlugins = [
  ...Object.values(modules),
  ...Object.values(fixtures),
].map((x) => x.default);
const ids = new Set<string>();
for (const p of browserPlugins) {
  if (p.apiVersion !== 1 || ids.has(p.id))
    throw new Error(`Incompatible or duplicate browser plugin ${p.id}`);
  ids.add(p.id);
}
