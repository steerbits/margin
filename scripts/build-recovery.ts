import { build } from "esbuild";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
const root = resolve(import.meta.dirname, "..");
const directory = resolve(
  process.env.MARGIN_DATA_DIR ?? join(root, ".margin-data"),
  "recovery",
);
mkdirSync(directory, { recursive: true });
const outfile = join(directory, "recover.mjs");
// Preserve the first installed recovery implementation independently of source restores.
if (!existsSync(outfile))
  await build({
    entryPoints: [join(root, "scripts/checkpoint-cli.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile,
  });
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
console.log(
  `Independent recovery command: node ${quote(outfile)} --root ${quote(root)} --data ${quote(resolve(directory, ".."))} list`,
);
