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

The verifier reads the actual README image references, checks each GIF's five-second duration, 480 × 300 size, 60 frames, infinite loop, and 250 kB per-file size budget. It also checks decoded Cobalt pixels and the light yellow comment highlight, then creates an animated, self-contained preview at `.margin-data/temporary/readme-demos/preview/index.html` and checks its desktop/mobile layout. The sample dashboard retains its own styling; only Margin's controls use Cobalt. Workspace display paths are sample paths, never the recording machine's filesystem paths.

## Regenerate the extended ten-demo gallery

```sh
npx playwright test --config scripts/readme-demos/playwright.config.ts
npx tsx scripts/readme-demos/gallery.ts
```

- `docs/demos/*.gif`: 480 × 300 images, 12 frames per second, looping indefinitely.
- `README-feature-gallery.md`: a two-column Markdown table, displaying each GIF at 440 × 275. Its relative paths work when copied into the root `README.md`.
- `.margin-data/readme-demo-preview/index.html`: a local animated preview, plus screenshots and verified GIF metadata.
- `.margin-data/temporary/readme-demos/frames/`: intermediate frames for inspecting the recordings.
- `.margin-data/temporary/readme-demos/results/`: capture test results and failure traces.

The capture suite builds an isolated app in a temporary folder on port 4356. It never reuses or restarts the normal Margin server. Conversations and generated artifacts use sample content from the existing test fixture API. The provider catalog is a fixture; sign-in and inference are not performed. The custom connection demo stops after entering example settings. The workspace clip demonstrates switching contexts, not OS sandbox enforcement. The installer is intentionally left as text rather than showing a sped-up or invented installation.

Screen crops, an overlay following actual pointer movements, and GIF encoding are applied only to the recordings. The crops include the bottom-docked composer. A full 256-color palette preserves pale yellow highlights that the old diff-only 128-color palette could quantize to gray. The production UI is unchanged. The generator checks that each recorded interaction finishes before the loop ends; the gallery script verifies durations, dimensions, frame counts, local image loading, and layout at desktop/mobile sizes.
