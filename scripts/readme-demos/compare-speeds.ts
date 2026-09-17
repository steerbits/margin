import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { readSandboxProof } from "./sandbox-proof.ts";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const work = join(root, ".margin-data/temporary/readme-speed-options");
const selected = process.argv.includes("--selected");
const preview = selected
  ? join(root, ".margin-data/temporary/readme-final-selection/preview")
  : join(work, "preview");
const hasSandbox = existsSync(join(work, "gifs/1x/sandbox-boundary.gif"));
if (selected)
  assert(
    hasSandbox,
    "Record the verified sandbox demo before building the selected set",
  );
if (hasSandbox)
  await readSandboxProof(join(work, "gifs/1x/sandbox-evidence.json"));
const chosenSpeed = (name: string) =>
  name === "review-web-app" ? "0.75x" : "1x";
const frames = join(root, ".margin-data/temporary/readme-demos/frames");
const demos = [
  [
    "inline-feedback",
    "Inline feedback",
    "Pull back after selecting the passage to keep the chat and comment editor together.",
  ],
  [
    "shape-together",
    "Shape the task together",
    "Show the whole choice box and its surrounding conversation.",
  ],
  [
    "review-web-app",
    "Review a generated dashboard",
    "Stay wide: a richer dashboard, muted chart colors, and the feedback panel.",
  ],
  [
    "customize-margin",
    "Customize Margin",
    "Move in while typing, then return to the wider chat view.",
  ],
  ...(hasSandbox
    ? [
        [
          "sandbox-boundary",
          "Workspace sandbox",
          "The real denied-write result, replayed in the demo chat. No file was created outside the workspace.",
        ] as const,
      ]
    : []),
] as const;
const ordered = selected ? [demos.at(-1)!, ...demos.slice(0, -1)] : demos;
await mkdir(join(work, "gifs/0.75x"), { recursive: true });
await mkdir(join(preview, "gifs"), { recursive: true });
const metadata = [];
const sections = [];
for (const [name, title, description] of ordered) {
  const normal = join(work, "gifs/1x", `${name}.gif`);
  const slow = join(work, "gifs/0.75x", `${name}.gif`);
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    "9",
    "-i",
    join(frames, name, "encoded/%03d.png"),
    "-filter_complex",
    "[0:v]split[a][b];[a]palettegen=stats_mode=full:max_colors=256[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop",
    "0",
    slow,
  ]);
  const hashes: string[][] = [];
  const figures = [];
  for (const [speed, file, expectedDuration] of [
    ["1x", normal, 5],
    ["0.75x", slow, 20 / 3],
  ] as const) {
    const info = JSON.parse(
      (
        await run("ffprobe", [
          "-v",
          "error",
          "-select_streams",
          "v:0",
          "-show_entries",
          "format=duration:stream=width,height,nb_frames",
          "-of",
          "json",
          file,
        ])
      ).stdout,
    );
    const stream = info.streams[0];
    assert.equal(stream.width, 960);
    assert.equal(stream.height, 600);
    assert.equal(Number(stream.nb_frames), 60);
    const duration = Number(info.format.duration);
    assert(
      Math.abs(duration - expectedDuration) <= 0.02,
      `${name}/${speed}: wrong playback speed`,
    );
    const gif = await readFile(file);
    const loop = gif.indexOf("NETSCAPE2.0");
    assert(
      loop >= 0 &&
        gif[loop + 11] === 3 &&
        gif[loop + 12] === 1 &&
        gif.readUInt16LE(loop + 13) === 0,
      "Infinite loop required",
    );
    assert(gif.length < 1_000_000, `${name}: GIF size budget exceeded`);
    const decoded = (
      await run("ffmpeg", [
        "-v",
        "error",
        "-i",
        file,
        "-fps_mode",
        "passthrough",
        "-pix_fmt",
        "rgba",
        "-f",
        "framemd5",
        "pipe:1",
      ])
    ).stdout;
    hashes.push(
      decoded
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split(",").at(-1)!.trim()),
    );
    await copyFile(file, join(preview, "gifs", `${name}-${speed}.gif`));
    metadata.push({
      name,
      speed,
      duration,
      width: 960,
      height: 600,
      displayWidth: 480,
      displayHeight: 300,
      frames: 60,
      bytes: gif.length,
      looping: true,
    });
    if (!selected || speed === chosenSpeed(name))
      figures.push(
        `<figure><figcaption><strong>${speed === "1x" ? "1× · Normal" : "0.75× · Slower"}</strong><span>${duration.toFixed(2)} seconds</span></figcaption><img src="gifs/${name}-${speed}.gif" width="480" alt="${title} at ${speed}" data-file="gifs/${name}-${speed}.gif"><p>${(gif.length / 1024).toFixed(0)} KiB · 960 × 600 pixels</p></figure>`,
      );
  }
  assert.equal(hashes[0].length, 60);
  assert.deepEqual(
    hashes[0],
    hashes[1],
    `${name}: speed options must contain exactly the same decoded pixels`,
  );
  // Check encoded colors in the completed interaction, not just CSS declarations.
  const pixels = (
    await run(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        normal,
        "-vf",
        "select=eq(n\\,59)",
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "pipe:1",
      ],
      { encoding: "buffer", maxBuffer: 3 * 1024 * 1024 },
    )
  ).stdout;
  const count = (color: number[]) => {
    let found = 0;
    for (let i = 0; i < pixels.length; i += 3)
      if (
        color.every(
          (value, channel) => Math.abs(pixels[i + channel] - value) <= 12,
        )
      )
        found++;
    return found;
  };
  if (name === "sandbox-boundary")
    assert(
      count([163, 39, 36]) >= 25,
      "Keep the real tool's error state red, not Cobalt",
    );
  else assert(count([66, 99, 212]) >= 25, `${name}: Cobalt accent lost`);
  if (name === "inline-feedback")
    assert(count([255, 239, 173]) >= 25, "Yellow passage highlight lost");
  if (name === "review-web-app") {
    assert(count([186, 121, 115]) >= 25, "Muted red chart missing");
    assert(count([216, 188, 121]) >= 25, "Muted yellow chart missing");
  }
  sections.push(
    `<section id="${name}"><header><div><h2>${title}${selected && name === "sandbox-boundary" ? " · new" : ""}</h2><p>${description}</p></div><button type="button">${selected ? "Replay" : "Replay both"}</button></header><div class="pair">${figures.join("")}</div></section>`,
  );
}
const status = hasSandbox
  ? '<section class="pending"><h2>Verified result, replayed presentation</h2><p>The host-terminal probe successfully wrote inside its disposable workspace, received <code>/bin/sh: ../outside/hello.txt: Operation not permitted</code> for the outside write, and confirmed that the outside file remained absent. Its bundled-cco hash matches this checkout.</p><p>The sandbox GIF replays that exact command, output, and exit code in the real Margin UI. It is not live inference or a live sandbox execution during the recording. No actual home files were targeted.</p></section>'
  : '<section class="pending"><h2>Sandbox demo not yet recorded</h2><p>A sandbox startup failure is not evidence of a denied file write. Run <code>npx tsx scripts/readme-demos/sandbox-proof.ts</code> from a normal terminal, then capture test 11. The probe requires an allowed inside write and a blocked outside write, using disposable files only.</p></section>';
const intro = selected
  ? "Your selected pacing: <strong>1× for all demos except the dashboard at 0.75×</strong>. The new sandbox clip is first. All files are 960 × 600, displayed at <strong>480 × 300</strong>. The README assets have not been replaced."
  : "Both versions contain the same frames: <strong>1× runs for 5 seconds</strong>; <strong>0.75× runs for 6.67 seconds</strong>. Each is shown at <strong>480 × 300</strong>, with 960 × 600 source pixels. Replay a pair to restart them together. The README GIFs have not been replaced.";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Margin GIFs — ${selected ? "selected playback speeds" : "choose the pace"}</title><style>
*{box-sizing:border-box}body{margin:0;background:#fff;color:#242424;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1080px;margin:auto;padding:28px 20px 50px}h1{font-size:30px;letter-spacing:-.8px;margin-bottom:10px}h2{font-size:20px;margin:0}p{color:#666;margin:6px 0 18px}.intro{max-width:760px}.badge{display:inline-block;background:#edf1fc;color:#3655bf;border-radius:5px;padding:4px 9px;font-size:12px}section{border-top:1px solid #e8e8e8;margin-top:32px;padding-top:24px}header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:28px}figure{margin:0}figcaption{display:flex;justify-content:space-between;max-width:480px;padding:8px 0 12px}figcaption span{font-size:13px;color:#777}img{display:block;max-width:100%;height:auto;outline:1px solid #e3e3e3;border-radius:5px}figure p{font-size:12px;margin-top:9px}button{font:inherit;font-size:13px;white-space:nowrap;background:#fff;border:1px solid #d5d5d5;border-radius:6px;padding:7px 12px;cursor:pointer}button:hover{background:#edf1fc;border-color:#c9d5f6}.pending{background:#fffaf0;border:1px solid #eee1bf;border-radius:8px;padding:20px}.pending h2{font-size:18px}code{font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#fff;padding:12px;border-radius:6px}.checks{font-size:13px;margin-top:30px}@media(max-width:1040px){.pair{grid-template-columns:1fr;gap:16px}}@media(max-width:500px){main{padding:20px 14px}header{display:block}header button{margin:0 0 14px}h1{font-size:26px}}
${selected ? "main{max-width:780px}.pair{grid-template-columns:1fr}" : ""}
</style></head><body><main><span class="badge">${demos.length} workflows · ${selected ? "selected speeds" : "2 speed options"} · ${hasSandbox ? "verified sandbox result" : "sandbox pending"}</span><h1>${selected ? "The selected README demos" : "Same clarity. Choose the pace."}</h1><p class="intro">${intro}</p>${sections.join("\n")}${status}<p class="checks">Checks: frame-by-frame pixel equality between speeds, timing, dimensions, loops, file sizes, Cobalt/yellow highlights, muted chart colors, and desktop/mobile image footprints at 1× and 2× device density. The dashboard and conversations are sample data recorded in an isolated app; no live inference. Visual review is agent self-review; live GitHub rendering and physical devices are untested.</p></main><script>document.querySelectorAll('section button').forEach(button=>button.addEventListener('click',()=>{const stamp=Date.now();button.closest('section').querySelectorAll('img').forEach(image=>image.src=image.dataset.file+'?replay='+stamp)}));</script></body></html>`;
await writeFile(join(preview, "index.html"), html);
await writeFile(
  join(preview, "metadata.json"),
  JSON.stringify(
    selected
      ? metadata.filter((item) => item.speed === chosenSpeed(item.name))
      : metadata,
    null,
    2,
  ),
);
await writeFile(
  join(preview, "all-variants.json"),
  JSON.stringify(metadata, null, 2),
);
const browser = await chromium.launch();
const sizing = [];
try {
  for (const deviceScaleFactor of [1, 2]) {
    const context = await browser.newContext({ deviceScaleFactor });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(preview, "index.html")).href);
    await page.waitForFunction(() =>
      [...document.images].every(
        (image) => image.complete && image.naturalWidth === 960,
      ),
    );
    for (const width of [1200, 800, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const images = await page.locator("img").evaluateAll((images) =>
        images.map((image) => {
          const box = image.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
      );
      assert.equal(images.length, demos.length * (selected ? 1 : 2));
      assert(
        images.every(
          (image) =>
            Math.abs(image.height - (image.width * 5) / 8) < 0.1 &&
            (width >= 800 ? image.width === 480 : image.width <= width - 28),
        ),
      );
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      sizing.push({ width, deviceScaleFactor, images });
      if (deviceScaleFactor === 1)
        await page.screenshot({
          path: join(preview, `layout-${width}.png`),
          fullPage: true,
        });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile(join(preview, "sizing.json"), JSON.stringify(sizing, null, 2));
console.log(
  `Verified ${metadata.length} GIFs: ${demos.length} identical-frame pairs at 1x / 0.75x. Sandbox ${hasSandbox ? "uses verified native-cco output" : "is pending"}.`,
);
console.log(`Preview: ${join(preview, "index.html")}`);
