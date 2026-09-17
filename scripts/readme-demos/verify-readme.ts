import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const preview = join(root, ".margin-data/temporary/readme-demos/preview");
const readme = await readFile(join(root, "README.md"), "utf8");
const references = [...readme.matchAll(/!\[([^\]]*)\]\(([^)]+\.gif)\)/g)];
if (!references.length) throw new Error("README contains no GIF references");
await mkdir(preview, { recursive: true });
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
const metadata = [];
const figures: string[] = [];
for (const [, caption, relative] of references) {
  const path = resolve(root, relative);
  const gif = await readFile(path);
  const { stdout } = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "format=duration:stream=width,height,nb_frames",
    "-of",
    "json",
    path,
  ]);
  const info = JSON.parse(stdout);
  const stream = info.streams[0];
  const duration = Number(info.format.duration);
  if (
    stream.width !== 480 ||
    stream.height !== 300 ||
    Number(stream.nb_frames) !== 60 ||
    Math.abs(duration - 5) > 0.01
  )
    throw new Error(
      `${relative}: expected 480×300, 60 frames, five seconds; got ${stdout}`,
    );
  const loop = gif.indexOf("NETSCAPE2.0");
  if (
    loop < 0 ||
    gif[loop + 11] !== 3 ||
    gif[loop + 12] !== 1 ||
    gif.readUInt16LE(loop + 13) !== 0
  )
    throw new Error(`${relative}: expected an infinite GIF loop`);
  if (gif.length > 250_000)
    throw new Error(`${relative}: exceeds the 250 kB README budget`);

  // Inspect decoded GIF pixels, not just the source PNGs: palette reduction can
  // erase pale highlight colors even when the original screenshots are correct.
  // Shape ends with a disabled Send; inspect its enabled composing state.
  const colorFrame = basename(path) === "shape-together.gif" ? 30 : 59;
  const decoded = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-vf",
      `select=eq(n\\,${colorFrame})`,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 1024 * 1024 },
  );
  const countNear = (color: number[]) => {
    let count = 0;
    for (let i = 0; i < decoded.stdout.length; i += 3)
      if (
        color.every(
          (value, channel) =>
            Math.abs(value - decoded.stdout[i + channel]) <= 12,
        )
      )
        count++;
    return count;
  };
  const cobaltPixels = countNear([66, 99, 212]);
  if (cobaltPixels < 25)
    throw new Error(
      `${relative}: frame ${colorFrame} lost its Cobalt action color`,
    );
  const yellowPixels = countNear([255, 239, 173]);
  if (basename(path) === "inline-feedback.gif" && yellowPixels < 25)
    throw new Error(
      `${relative}: pale yellow comment highlight was lost during encoding`,
    );
  metadata.push({
    path: relative,
    width: stream.width,
    height: stream.height,
    frames: Number(stream.nb_frames),
    duration,
    bytes: gif.length,
    looping: true,
    colorFrame,
    cobaltPixels,
    yellowPixels,
  });
  figures.push(
    `<figure><figcaption>${escape(caption)}</figcaption><img src="data:image/gif;base64,${gif.toString("base64")}" alt="${escape(caption)}" width="480" height="300"><p><code>${escape(relative)}</code> · ${(gif.length / 1024).toFixed(1)} KiB</p></figure>`,
  );
}
await writeFile(
  join(preview, "metadata.json"),
  JSON.stringify(metadata, null, 2),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Margin — refreshed README GIFs</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#212121;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1080px;margin:auto;padding:28px 20px}h1{line-height:1.2}p{color:#555}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}figure{margin:0}figcaption{font-weight:600;margin:12px 0}img{display:block;max-width:100%;height:auto;border:1px solid #e5e5e5;border-radius:6px}figure p{font-size:12px;overflow-wrap:anywhere}@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:20px 12px}}
</style></head><body><main><h1>Refreshed README GIFs</h1><p>The same five workflows, now with Cobalt accents and lighter yellow comment highlights. Each GIF loops in five seconds at 480 × 300.</p><div class="grid">${figures.join("\n")}</div><p>Recorded in Chromium against an isolated test app with sample content. No live sign-in or inference. Workspace names and display paths are demo data; that clip shows context switching, not filesystem sandbox enforcement. The sample dashboard retains its own styling.</p><p>Checks: capture interactions complete before the final hold; all GIF dimensions, frame counts, loop metadata, file sizes, and decoded accent colors validated. This preview was checked at desktop and mobile widths.</p></main></body></html>`;
const htmlPath = join(preview, "index.html");
await writeFile(htmlPath, html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() =>
    [...document.images].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  for (const [width, height] of [
    [1200, 1000],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw new Error(`Preview overflows at ${width}px`);
    await page.screenshot({
      path: join(preview, `preview-${width}.png`),
      fullPage: true,
    });
  }
} finally {
  await browser.close();
}
console.log(
  `Verified ${metadata.length} README GIFs, ${(metadata.reduce((sum, item) => sum + item.bytes, 0) / 1024).toFixed(1)} KiB total.`,
);
console.log(`Preview: ${htmlPath}`);
