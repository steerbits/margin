import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";
import { readmeGifReferences } from "./readme-images.ts";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const preview = join(root, ".margin-data/temporary/readme-demos/preview");
const references = readmeGifReferences(
  await readFile(join(root, "README.md"), "utf8"),
);
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
for (const { caption, path: relative } of references) {
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
    stream.width !== 960 ||
    stream.height !== 600 ||
    Number(stream.nb_frames) !== 60 ||
    Math.abs(duration - 5) > 0.01
  )
    throw new Error(
      `${relative}: expected 960×600, 60 frames, five seconds; got ${stdout}`,
    );
  const loop = gif.indexOf("NETSCAPE2.0");
  if (
    loop < 0 ||
    gif[loop + 11] !== 3 ||
    gif[loop + 12] !== 1 ||
    gif.readUInt16LE(loop + 13) !== 0
  )
    throw new Error(`${relative}: expected an infinite GIF loop`);
  if (gif.length > 1_000_000)
    throw new Error(`${relative}: exceeds the 1 MB retina GIF budget`);

  // Inspect every decoded frame at native resolution. Thin outlines blend
  // with white when displayed at 480px, but must retain their encoded color.
  // Camera movement means an accent need not remain in the final frame.
  const decoded = await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path,
      "-fps_mode",
      "passthrough",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "pipe:1",
    ],
    { encoding: "buffer", maxBuffer: 128 * 1024 * 1024 },
  );
  const frameBytes = 960 * 600 * 3;
  if (decoded.stdout.length !== frameBytes * 60)
    throw new Error(`${relative}: incomplete GIF decode`);
  const colors = Array.from({ length: 60 }, (_, frame) => ({
    frame,
    cobalt: 0,
    yellow: 0,
  }));
  for (let i = 0; i < decoded.stdout.length; i += 3) {
    const [r, g, b] = [
      decoded.stdout[i],
      decoded.stdout[i + 1],
      decoded.stdout[i + 2],
    ];
    const frame = colors[Math.floor(i / frameBytes)];
    if (
      Math.abs(r - 66) <= 12 &&
      Math.abs(g - 99) <= 12 &&
      Math.abs(b - 212) <= 12
    )
      frame.cobalt++;
    if (
      Math.abs(r - 255) <= 12 &&
      Math.abs(g - 239) <= 12 &&
      Math.abs(b - 173) <= 12
    )
      frame.yellow++;
  }
  const cobalt = colors.reduce((a, b) => (a.cobalt > b.cobalt ? a : b));
  const yellow = colors.reduce((a, b) => (a.yellow > b.yellow ? a : b));
  if (cobalt.cobalt < 25)
    throw new Error(`${relative}: lost its Cobalt accents`);
  if (basename(path) === "inline-feedback.gif" && yellow.yellow < 25)
    throw new Error(
      `${relative}: pale yellow highlight is missing from the encoded GIF`,
    );
  metadata.push({
    path: relative,
    width: 960,
    height: 600,
    displayWidth: 480,
    displayHeight: 300,
    frames: 60,
    duration,
    bytes: gif.length,
    looping: true,
    cobaltFrame: cobalt.frame,
    cobaltPixels: cobalt.cobalt,
    yellowFrame: yellow.frame,
    yellowPixels: yellow.yellow,
  });
  figures.push(
    `<figure><figcaption>${escape(caption)}</figcaption><img src="data:image/gif;base64,${gif.toString("base64")}" alt="${escape(caption)}" width="480"><p><code>${escape(relative)}</code> · ${(gif.length / 1024).toFixed(1)} KiB</p></figure>`,
  );
}
await writeFile(
  join(preview, "metadata.json"),
  JSON.stringify(metadata, null, 2),
);
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Margin — sharper README GIFs</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#212121;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1080px;margin:auto;padding:28px 20px}h1{line-height:1.2}p{color:#555}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}figure{margin:0}figcaption{font-weight:600;margin:12px 0}img{display:block;max-width:100%;height:auto;outline:1px solid #e5e5e5;border-radius:6px}figure p{font-size:12px;overflow-wrap:anywhere}@media(max-width:1040px){.grid{grid-template-columns:1fr}}@media(max-width:500px){main{padding:20px 12px}}
</style></head><body><main><h1>Sharper README GIFs</h1><p>All five workflows now use 2× capture and close-ups where the action happens. The files are <strong>960 × 600</strong>; the visible README footprint remains <strong>480 × 300</strong>, shrinking proportionally on narrow screens. Each loop is five seconds.</p><div class="grid">${figures.join("\n")}</div><p>Close-ups preserve the app’s fonts and styling. All clips use the current Cobalt UI with pale yellow comment highlights.</p><p>Recorded in Chromium against an isolated test app with sample content. No live sign-in or inference. Workspace names and display paths are demo data; that clip shows context switching, not filesystem sandbox enforcement. The sample dashboard retains its own styling.</p><p>Checks: completed capture interactions, real-time pacing, dimensions, frame counts, infinite loops, file sizes, and decoded accent colors. Desktop/mobile footprints are checked at 1× and 2× screen density. Visual review is agent self-review; live GitHub rendering and physical devices have not been tested.</p></main></body></html>`;
const htmlPath = join(preview, "index.html");
await writeFile(htmlPath, html);
// Also check the literal README tags (not a preview-only width override).
const embedPath = join(preview, "readme-embeds.html");
await writeFile(
  embedPath,
  `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(root + "/").href}"><style>body{margin:0;padding:12px}img{display:block;max-width:100%;margin:12px 0}</style>${references.map((item) => item.tag).join("\n")}`,
);
const browser = await chromium.launch();
const sizing = [];
try {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ deviceScaleFactor });
    const page = await context.newPage();
    for (const file of [embedPath, htmlPath]) {
      await page.goto(pathToFileURL(file).href);
      await page.waitForFunction(() =>
        [...document.images].every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      );
      for (const width of [1200, 800, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const images = await page.locator("img").evaluateAll((images) =>
          images.map((image) => {
            const box = image.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              naturalWidth: (image as HTMLImageElement).naturalWidth,
            };
          }),
        );
        if (
          images.length !== references.length ||
          images.some(
            (image) =>
              image.naturalWidth !== 960 ||
              Math.abs(image.height - (image.width * 5) / 8) > 0.1 ||
              (width >= 800 ? image.width !== 480 : image.width > width),
          )
        )
          throw new Error(
            `${basename(file)}: wrong display size at ${width}px / ${deviceScaleFactor}×`,
          );
        if (
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          )
        )
          throw new Error(
            `${basename(file)}: horizontal overflow at ${width}px`,
          );
        sizing.push({ file: basename(file), width, deviceScaleFactor, images });
        if (file === htmlPath && deviceScaleFactor === 1)
          await page.screenshot({
            path: join(preview, `preview-${width}.png`),
            fullPage: true,
          });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(join(preview, "sizing.json"), JSON.stringify(sizing, null, 2));
console.log(
  `Verified ${metadata.length} retina README GIFs, ${(metadata.reduce((sum, item) => sum + item.bytes, 0) / 1024).toFixed(1)} KiB total; desktop footprint remains 480×300.`,
);
console.log(`Preview: ${htmlPath}`);
