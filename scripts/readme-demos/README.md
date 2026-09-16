# README feature demos

Generate compact, five-second GIFs of Margin's UI and a Markdown gallery for the repository README.

Prerequisites: the repository's npm dependencies, Playwright Chromium (`npx playwright install chromium`), and `ffmpeg` / `ffprobe` on PATH.

From the repository root:

```sh
npx playwright test --config scripts/readme-demos/playwright.config.ts
npx tsx scripts/readme-demos/gallery.ts
```

- `docs/demos/*.gif`: 480 × 300 images, 12 frames per second, looping indefinitely.
- `README-feature-gallery.md`: a two-column Markdown table, displaying each GIF at 440 × 275. Its relative paths work when copied into the root `README.md`.
- `.margin-data/readme-demo-preview/index.html`: a local animated preview, plus screenshots and verified GIF metadata.
- `.margin-data/readme-demo-frames/`: intermediate frames for inspecting the recordings.

The capture suite builds an isolated app in a temporary folder on port 4356. It never reuses or restarts the normal Margin server. Conversations and generated artifacts use sample content from the existing test fixture API. The provider catalog is a fixture; sign-in and inference are not performed. The custom connection demo stops after entering example settings. The workspace clip demonstrates switching contexts, not OS sandbox enforcement. The installer is intentionally left as text rather than showing a sped-up or invented installation.

Screen crops, an overlay following actual pointer movements, and GIF encoding are applied only to the recordings. The production UI is unchanged. The generator checks that each recorded interaction finishes before the loop ends; the gallery script verifies durations, dimensions, frame counts, local image loading, and layout at desktop/mobile sizes.
