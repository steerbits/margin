import { mkdir, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const preview = join(root, ".margin-data/temporary/readme-demos/gallery");
const demos = [
  [
    "inline-feedback",
    "Comment directly on AI replies",
    "Select a passage and leave feedback in the margin.",
  ],
  [
    "shape-together",
    "Shape the task together",
    "Choose a direction, add your constraints, and refine the plan.",
  ],
  [
    "review-markdown",
    "Review generated documents",
    "Attach feedback to the exact passage in a Markdown artifact.",
  ],
  [
    "review-web-app",
    "Point and comment on web apps",
    "Point to an element and say what should change.",
  ],
  [
    "project-workspaces",
    "Keep project contexts separate",
    "Switch projects with their own conversations and shared notes.",
  ],
  [
    "customize-margin",
    "Ask AI to customize Margin",
    "Pick a starting idea, then describe the change you want.",
  ],
  [
    "plugins",
    "Extend Margin with plugins",
    "Manage extensions such as the project notepad.",
  ],
  [
    "workflow-skills",
    "Choose your workflow",
    "Start a conversation with a Pi skill such as Shape with me.",
  ],
  [
    "ai-connections",
    "Bring subscriptions and API keys",
    "Connect ChatGPT / Codex, Claude, OpenRouter, and more.",
  ],
  [
    "custom-models",
    "Use local or custom models",
    "Set your server URL, authentication, and model ID.",
  ],
] as const;

const metadata = [];
for (const [file, title] of demos) {
  const path = join(root, "docs/demos", `${file}.gif`);
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
  const duration = Number(info.format.duration);
  const stream = info.streams[0];
  if (
    duration < 3 ||
    duration > 5.01 ||
    !(
      (stream.width === 480 && stream.height === 300) ||
      (stream.width === 960 && stream.height === 600)
    ) ||
    Number(stream.nb_frames) < 30
  ) {
    throw new Error(
      `${file}: unexpected GIF dimensions or duration: ${stdout}`,
    );
  }
  metadata.push({
    file: `${file}.gif`,
    title,
    duration,
    width: stream.width,
    height: stream.height,
    frames: Number(stream.nb_frames),
    bytes: (await stat(path)).size,
  });
}

const cells = demos.map(
  ([file, title, caption]) =>
    `**${title}**<br><img src="docs/demos/${file}.gif" width="440" alt="${caption}"><br>${caption}`,
);
const rows = Array.from(
  { length: cells.length / 2 },
  (_, i) => `| ${cells[i * 2]} | ${cells[i * 2 + 1]} |`,
);
const markdown = `## Margin in action

Short demos with example content. Each clip loops in five seconds.

| | |
| --- | --- |
${rows.join("\n")}

The workspace clip shows separate project contexts. Filesystem sandbox enforcement is described in the README; it is not demonstrated by this recording.
`;
await writeFile(join(root, "README-feature-gallery.md"), markdown);
await mkdir(preview, { recursive: true });
await writeFile(
  join(preview, "metadata.json"),
  JSON.stringify(metadata, null, 2),
);
const htmlRows = rows
  .map(
    (row) =>
      `<tr>${row
        .split("|")
        .slice(1, -1)
        .map(
          (cell) =>
            `<td>${cell.trim().replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")}</td>`,
        )
        .join("")}</tr>`,
  )
  .join("\n");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${pathToFileURL(root + "/").href}"><title>Margin — README gallery preview</title><style>
body{margin:0;background:white;color:#1f2328;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:936px;margin:32px auto;padding:24px;border:1px solid #d1d9e0;border-radius:6px}h2{font-size:24px;line-height:1.25;border-bottom:1px solid #d1d9e0;padding-bottom:10px;margin:0 0 16px}table{border-collapse:collapse;table-layout:fixed;width:100%;margin:16px 0}td{width:50%;padding:12px;border:1px solid #d1d9e0;text-align:center;vertical-align:top;font-size:12px}td strong{display:inline-block;font-size:14px;margin-bottom:10px}img{display:block;max-width:100%;height:auto;margin:0 auto 10px}p{margin:12px 0}.note{color:#59636e;font-size:12px}@media(max-width:650px){main{margin:0;border:0;padding:12px}td{padding:6px;font-size:10px}td strong{font-size:11px}}
</style></head><body><main><h2>Margin in action</h2><p>Short demos with example content. Each clip loops in five seconds.</p><table><tbody>${htmlRows}</tbody></table><p class="note">The workspace clip shows separate project contexts. Filesystem sandbox enforcement is described in the README; it is not demonstrated by this recording.</p></main></body></html>`;
const htmlPath = join(preview, "index.html");
await writeFile(htmlPath, html);

// Check the actual rendered table and keep desktop/mobile previews for review.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForFunction(() =>
    [...document.images].every(
      (image) => image.complete && image.naturalWidth > 0,
    ),
  );
  const visible = await page
    .locator("td img")
    .evaluateAll(
      (images) =>
        images.filter(
          (image) => image.getBoundingClientRect().bottom <= innerHeight,
        ).length,
    );
  if (visible < 4)
    throw new Error(
      `Only ${visible} complete GIFs fit in the desktop viewport`,
    );
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(preview, "desktop.png") });
  await page.screenshot({
    path: join(preview, "full-gallery.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("The gallery overflows the mobile viewport");
  await page.screenshot({ path: join(preview, "mobile.png") });
} finally {
  await browser.close();
}
const total = metadata.reduce((sum, demo) => sum + demo.bytes, 0);
console.log(
  `Wrote README-feature-gallery.md with ${demos.length} GIFs (${(total / 1024 / 1024).toFixed(2)} MiB total).`,
);
console.log(`Preview: ${htmlPath}`);
