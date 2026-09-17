import { expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
export const framesRoot = resolve(".margin-data/temporary/readme-demos/frames");
export const output = resolve(process.env.MARGIN_DEMO_OUTPUT ?? "docs/demos");
export const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
export type Clip = { x: number; y: number; width: number; height: number };
const fps = 12;
const frameCount = 60;

/** A recording-only camera. It never changes the app's DOM, fonts or layout. */
export class Camera {
  private from: Clip;
  private target: Clip;
  private changedAt = 0;
  constructor(
    initial: Clip,
    readonly bounds?: Clip,
  ) {
    this.from = this.target = initial;
  }
  at(now = performance.now()): Clip {
    const t = Math.max(0, Math.min(1, (now - this.changedAt) / 420));
    const p = t * t * (3 - 2 * t);
    const mix = (key: keyof Clip) =>
      this.from[key] + (this.target[key] - this.from[key]) * p;
    return {
      x: mix("x"),
      y: mix("y"),
      width: mix("width"),
      height: mix("height"),
    };
  }
  move(target: Clip) {
    this.from = this.at();
    this.target = target;
    this.changedAt = performance.now();
  }
  async focus(locator: Locator, options: Parameters<typeof frame>[1] = {}) {
    this.move(await frame(locator, options));
  }
}

/** Keep key text at native CSS size in the fixed 480px README footprint. */
export async function frame(
  locator: Locator,
  { left = 24, top = 40, centerY = false, width = 480 } = {},
): Promise<Clip> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("Missing camera target");
  const height = (width * 5) / 8;
  return {
    x: Math.max(0, box.x - left),
    y: Math.max(0, centerY ? box.y + box.height / 2 - height / 2 : box.y - top),
    width,
    height,
  };
}

export async function frameTogether(
  locators: Locator[],
  minWidth = 800,
): Promise<Clip> {
  const boxes = await Promise.all(
    locators.map((locator) => locator.boundingBox()),
  );
  if (boxes.some((box) => !box)) throw new Error("Missing camera target");
  const left = Math.min(...boxes.map((box) => box!.x)) - 24;
  const top = Math.min(...boxes.map((box) => box!.y)) - 24;
  const right = Math.max(...boxes.map((box) => box!.x + box!.width)) + 24;
  const bottom = Math.max(...boxes.map((box) => box!.y + box!.height)) + 24;
  const width = Math.max(minWidth, right - left, ((bottom - top) * 8) / 5);
  const height = (width * 5) / 8;
  const clip = {
    x: Math.max(0, (left + right - width) / 2),
    y: Math.max(0, (top + bottom - height) / 2),
    width,
    height,
  };
  for (const box of boxes) {
    expect(box!.x).toBeGreaterThanOrEqual(clip.x);
    expect(box!.y).toBeGreaterThanOrEqual(clip.y);
    expect(box!.x + box!.width).toBeLessThanOrEqual(clip.x + width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(clip.y + height);
  }
  return clip;
}

export async function record(
  page: Page,
  name: string,
  view: Clip | Camera,
  actions: () => Promise<void>,
) {
  const folder = join(framesRoot, name);
  const raw = join(folder, "raw");
  const normalized = join(folder, "encoded");
  await mkdir(raw, { recursive: true });
  await mkdir(normalized, { recursive: true });
  await mkdir(output, { recursive: true });
  // Keep the extended gallery's unfocused recordings at their original 1x
  // density. Only the five camera-guided README clips opt into retina output.
  const density = view instanceof Camera ? 2 : 1;
  const outputWidth = 480 * density;
  const outputHeight = 300 * density;
  if (density === 2)
    expect(
      await page.evaluate(() => devicePixelRatio),
      "Retina capture, not an upscaled 1x screenshot",
    ).toBe(2);
  await page.evaluate(() => document.fonts.ready);
  // Capture just the camera's visible intersection at 2x. Full-viewport 2x
  // screenshots of the live iframe are too slow to preserve real-time 12fps.
  const captureSession = await page.context().newCDPSession(page);
  const viewport = page.viewportSize()!;
  const bounds =
    view instanceof Camera && view.bounds
      ? view.bounds
      : { x: 0, y: 0, ...viewport };
  const start = performance.now();
  const samples: { frame: number; elapsedMs: number; clip: Clip }[] = [];
  const capture = async () => {
    for (let i = 0; performance.now() - start < 5000; i++) {
      const due =
        i === 0 ? 0 : Math.max((i * 1000) / fps, performance.now() - start);
      await pause(Math.max(0, start + due - performance.now()));
      if (performance.now() - start >= 5000) break;
      const requested = view instanceof Camera ? view.at() : view;
      const clip = Object.fromEntries(
        Object.entries(requested).map(([key, value]) => [
          key,
          Math.round(value),
        ]),
      ) as Clip;
      clip.x = Math.max(Math.ceil(bounds.x), clip.x);
      clip.y = Math.max(Math.ceil(bounds.y), clip.y);
      const width = Math.floor(
        Math.min(clip.width, bounds.x + bounds.width - clip.x),
      );
      const height = Math.floor(
        Math.min(clip.height, bounds.y + bounds.height - clip.y),
      );
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      const elapsedMs = performance.now() - start;
      const screenshot = await captureSession.send("Page.captureScreenshot", {
        format: "png",
        captureBeyondViewport: false,
        optimizeForSpeed: true,
        clip: { x: clip.x, y: clip.y, width, height, scale: density },
      });
      const png = Buffer.from(screenshot.data, "base64");
      // Check actual PNG dimensions, not only emulated devicePixelRatio.
      expect(png.readUInt32BE(16)).toBe(width * density);
      expect(png.readUInt32BE(20)).toBe(height * density);
      await writeFile(join(raw, `${String(i).padStart(3, "0")}.png`), png);
      samples.push({ frame: i, elapsedMs, clip });
    }
  };
  const [, actionDurationMs] = await Promise.all([
    capture(),
    actions().then(() => performance.now() - start),
  ]).finally(() => captureSession.detach().catch(() => {}));
  expect(
    actionDurationMs,
    `${name}: finish before the final hold`,
  ).toBeLessThan(4400);
  expect(
    samples.length,
    `${name}: at least 6 actual captures per second`,
  ).toBeGreaterThanOrEqual(30);
  expect(
    samples.at(-1)!.elapsedMs,
    `${name}: capture the final hold`,
  ).toBeGreaterThan(4700);
  for (let i = 1; i < samples.length; i++)
    expect(
      samples[i].elapsedMs - samples[i - 1].elapsedMs,
      `${name}: no long recording gaps`,
    ).toBeLessThan(350);
  // Keep wall-clock pacing even when a wide 2x iframe takes longer than 1/12s
  // to capture. Repeat the latest available image; never accelerate a backlog.
  const timeline = Array.from({ length: frameCount }, (_, frame) => ({
    frame,
    sample:
      samples.findLast((sample) => sample.elapsedMs <= (frame * 1000) / fps) ??
      samples[0],
  }));

  // Normalize each moving crop before palette generation. White padding allows
  // a close-up near the viewport edge without pulling unrelated controls in.
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < timeline.length) {
        const {
          frame: i,
          sample: { frame: rawFrame, clip },
        } = timeline[next++];
        const [width, height] = [clip.width, clip.height].map(
          (value) => value * density,
        );
        const file = `${String(i).padStart(3, "0")}.png`;
        await run("ffmpeg", [
          "-hide_banner",
          "-loglevel",
          "error",
          "-y",
          "-threads",
          "1",
          "-filter_threads",
          "1",
          "-i",
          join(raw, `${String(rawFrame).padStart(3, "0")}.png`),
          "-vf",
          `pad=${width}:${height}:0:0:color=white,scale=${outputWidth}:${outputHeight}:flags=lanczos`,
          "-frames:v",
          "1",
          join(normalized, file),
        ]);
      }
    }),
  );
  await run("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-framerate",
    String(fps),
    "-i",
    join(normalized, "%03d.png"),
    "-filter_complex",
    // A full palette preserves pale highlights. No dithering keeps flat UI
    // surfaces and text edges clean when the browser downsamples the 2x image.
    "[0:v]split[a][b];[a]palettegen=stats_mode=full:max_colors=256[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
    "-loop",
    "0",
    join(output, `${name}.gif`),
  ]);
  await writeFile(
    join(folder, "capture.json"),
    JSON.stringify(
      {
        viewport: page.viewportSize(),
        density,
        width: outputWidth,
        height: outputHeight,
        displayWidth: 480,
        displayHeight: 300,
        fps,
        frames: frameCount,
        duration: frameCount / fps,
        actionDurationMs,
        capturedFrames: samples.length,
        samples,
        timeline,
      },
      null,
      2,
    ),
  );
}
