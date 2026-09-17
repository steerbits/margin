# README feature demos

Generate compact, five-second GIFs of Margin's UI for the repository README and an optional extended Markdown gallery.

Prerequisites: the repository's npm dependencies, Playwright Chromium (`npx playwright install chromium`), and `ffmpeg` / `ffprobe` on PATH.

## Refresh the five GIFs currently embedded in README.md

From the repository root (no README text or image-link changes needed):

```sh
MARGIN_DEMO_OUTPUT=.margin-data/temporary/readme-demos/gifs \
  npx playwright test --config scripts/readme-demos/playwright.config.ts --grep '0[12456] '
for name in inline-feedback shape-together review-web-app customize-margin; do
  cp ".margin-data/temporary/readme-demos/gifs/$name.gif" "docs/images/$name.gif"
done
cp .margin-data/temporary/readme-demos/gifs/project-workspaces.gif docs/demos/project-workspaces.gif
npx tsx scripts/readme-demos/verify-readme.ts
```

The files are **960 × 600**, but the README's `<img width="480">` embeds keep the visible footprint at **480 × 300**. Do not replace those tags with unconstrained Markdown images: that would double their displayed size. Omit a fixed height so narrow screens scale proportionally.

The verifier reads those actual embeds, checks each GIF's five-second duration, 960 × 600 intrinsic size, 60 frames, infinite loop, and 1 MB per-file size budget. It inspects every decoded frame for Cobalt accents and the inline demo's pale yellow highlight. It then creates an animated, self-contained preview at `.margin-data/temporary/readme-demos/preview/index.html` and checks both that preview and the literal README image tags at 1200, 800, and 390px viewport widths, with 1× and 2× device density. These are local Chromium checks, not a live GitHub or physical-device test. The sample dashboard retains its own styling; only Margin's controls use Cobalt. Workspace display paths are sample paths, never the recording machine's filesystem paths.

## Regenerate the extended ten-demo gallery

```sh
npx playwright test --config scripts/readme-demos/playwright.config.ts
npx tsx scripts/readme-demos/gallery.ts
```

- `docs/demos/*.gif`: the five camera-guided README workflows are 960 × 600; the remaining wide-frame gallery recordings retain their original 480 × 300 output. All use 12 frames per second and loop indefinitely.
- `README-feature-gallery.md`: a two-column Markdown table, displaying each GIF at 440 × 275. Its relative paths work when copied into the root `README.md`.
- `.margin-data/temporary/readme-demos/gallery/index.html`: a local animated preview, plus screenshots and verified GIF metadata.
- `.margin-data/temporary/readme-demos/frames/`: raw camera crops (2× for the README clips), normalized frames, and per-demo `capture.json` camera/timing metadata.
- `.margin-data/temporary/readme-demos/results/`: capture test results and failure traces.

The capture suite builds an isolated app in a temporary folder on port 4356. It never reuses or restarts the normal Margin server. Conversations and generated artifacts use sample content from the existing test fixture API. The provider catalog is a fixture; sign-in and inference are not performed. The custom connection demo stops after entering example settings. The workspace clip demonstrates switching contexts, not OS sandbox enforcement. The installer is intentionally left as text rather than showing a sped-up or invented installation.

A smooth camera follows each interaction into its relevant controls, comment card, or composer instead of shrinking the entire app into the frame. The planning clip uses a narrower real viewport so its final reply fits. Camera crops, a pointer overlay, white padding at window edges, and GIF encoding apply only to the recordings; production fonts, sizes, layout, and styling are unchanged.

For the five README clips, the recorder captures actual 2× pixels and asserts each source PNG's dimensions, rather than upscaling a 1× image. Unfocused extended-gallery recordings retain 1× capture to avoid slowing them down. It captures only the visible camera area to keep iframe recording fast enough. It rejects slow captures instead of silently accelerating them, and requires the interaction to finish before the five-second loop ends. Encoding uses a full 256-color palette and no dithering, preserving the pale yellow highlights that a diff-only 128-color palette could quantize to gray. Unit coverage protects the constrained README embeds; visual review of the decoded output still matters for framing and readability.
