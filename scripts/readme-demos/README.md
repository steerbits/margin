# README feature demos

Generate compact, five-second GIFs of Margin's UI for the repository README and an optional extended Markdown gallery.

Prerequisites: the repository's npm dependencies, Playwright Chromium (`npx playwright install chromium`), and `ffmpeg` / `ffprobe` on PATH.

## Review the current framing changes at both speeds (do not publish yet)

```sh
MARGIN_DEMO_OUTPUT=.margin-data/temporary/readme-speed-options/gifs/1x \
  npx playwright test --config scripts/readme-demos/playwright.config.ts --grep '0[1246] |11 '
npx tsx scripts/readme-demos/compare-speeds.ts
# Selected set: 1x throughout, except review-web-app at 0.75x.
npx tsx scripts/readme-demos/compare-speeds.ts --selected
```

With the verified sandbox evidence below, this creates **five** revised workflows at 1× (5 seconds) and 0.75× (6.67 seconds). The full comparison is at `.margin-data/temporary/readme-speed-options/preview/index.html`; `--selected` writes the chosen five-demo preview to `.margin-data/temporary/readme-final-selection/preview/index.html`, putting the new sandbox clip first. It uses 1× for inline feedback, planning, customization, and sandboxing, and 0.75× for the dashboard.

Both speeds contain identical decoded frames, not independent recordings. The comparison verifies those pixel hashes, playback timing, loops, dimensions, accent/chart/error colors, size budgets, and responsive 480px display width. Neither mode edits `README.md` or its GIFs. The selected set is still a preview, pending approval to replace the README assets.

### Sandbox evidence and replay

The new candidate is `sandbox-boundary.gif`; the existing project-switching clip is untouched. The host-terminal probe succeeded: an inside write was allowed, the outside write returned `/bin/sh: ../outside/hello.txt: Operation not permitted`, and the outside file remained absent. This is different from `sandbox_apply: Operation not permitted`, which only means sandbox startup failed.

To reproduce the proof on another checkout, run from a normal macOS terminal at the repository root:

```sh
npx tsx scripts/readme-demos/sandbox-proof.ts
```

The probe uses the bundled native cco, writes an allowed control file inside a disposable workspace, attempts `../outside/hello.txt`, and verifies the outside file is absent and its sentinel is unchanged. All targets are under `.margin-data/temporary/` (not `/tmp`, which cco allows); no real home files are targeted. It saves raw diagnostics to `sandbox/attempt.json`, emits `sandbox/proof.json` only on success, removes stale success evidence before each run, and cleans up the probe directories. Capture test 11 reads the saved proof without rerunning the probe, validates all checks and its bundled-cco hash, and then replays the exact command/output/exit code in the disposable app. These are persisted fixture transcript entries, not live inference or live tool execution during the recording. The test skips if proof is absent; `--selected` refuses an incomplete set. The comparison checks the error state remains red, not Cobalt.

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
npx playwright test --config scripts/readme-demos/playwright.config.ts --grep '^(0[1-9]|10) '
npx tsx scripts/readme-demos/gallery.ts
```

- `docs/demos/*.gif`: the five camera-guided README workflows are 960 × 600; the remaining wide-frame gallery recordings retain their original 480 × 300 output. All use 12 frames per second and loop indefinitely.
- `README-feature-gallery.md`: a two-column Markdown table, displaying each GIF at 440 × 275. Its relative paths work when copied into the root `README.md`.
- `.margin-data/temporary/readme-demos/gallery/index.html`: a local animated preview, plus screenshots and verified GIF metadata.
- `.margin-data/temporary/readme-demos/frames/`: raw camera crops (2× for the README clips), normalized frames, and per-demo `capture.json` camera/timing metadata.
- `.margin-data/temporary/readme-demos/results/`: capture test results and failure traces.

The capture suite builds an isolated app in a temporary folder on port 4356. It never reuses or restarts the normal Margin server. Conversations and generated artifacts use sample content from the existing test fixture API. The provider catalog is a fixture; sign-in and inference are not performed. The custom connection demo stops after entering example settings. The legacy workspace-switching clip demonstrates contexts, not OS sandbox enforcement. The separate sandbox clip is an explicitly disclosed replay of a verified native-cco denial. The installer is intentionally left as text rather than showing a sped-up or invented installation.

A smooth camera follows each interaction into its relevant controls, comment card, or composer instead of shrinking the entire app into the frame. The planning clip uses a narrower real viewport so its final reply fits. Camera crops, a pointer overlay, white padding at window edges, and GIF encoding apply only to the recordings; production fonts, sizes, layout, and styling are unchanged.

For the five README clips, the recorder captures actual 2× pixels and asserts each source PNG's dimensions, rather than upscaling a 1× image. Unfocused extended-gallery recordings retain 1× capture to avoid slowing them down. It captures only the visible camera area to keep iframe recording fast enough. It keeps wall-clock pacing when wide iframe captures are slower than 12fps: the latest captured frame is repeated instead of accelerating a backlog. Capture must still provide at least six actual frames per second on average, have no gap over 350ms, and include the final hold. Each interaction must finish before the five-second loop ends. Encoding uses a full 256-color palette and no dithering, preserving the pale yellow highlights that a diff-only 128-color palette could quantize to gray. Unit coverage protects the constrained README embeds; visual review of the decoded output still matters for framing and readability.
