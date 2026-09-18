# Releases and update discovery

Margin distinguishes **source version**, **published release**, and **running version**. Ordinary commits do not announce updates. `package.json` owns the source version; the release script synchronizes the lockfile and generates `releases/stable.json` as the public stable pointer. No release is advertised until that pointer contains a release and is explicitly pushed.

## Maintainer workflow

Work on a clean `main` checkout, with no in-progress merge/rebase. Choose a stable `major.minor.patch` version newer than both the source and published release. Semantic ordering does **not** control notification prominence.

```sh
bash scripts/release.sh prepare 0.2.0
```

This saves local preparation metadata under `.margin-data/releases/` and prints a coding-agent prompt with the previous published commit and candidate commit. For the first release it explicitly requests review of the full source tree/history rather than inventing a previous release. Write notes to `releases/0.2.0/README.md`, with useful screenshots/images inside that version folder and relative links. Images must use PNG/JPEG/GIF/WebP, not remote URLs or private-data links. Review content and images yourself and commit those files. Validation checks structure/links, not factual accuracy or absence of secrets.

If application code changes, prepare again and refresh the notes. Finalization allows only the reviewed notes/assets to have changed since preparation; it rejects stale preparation, dirty checkouts, existing tags, and inconsistent version metadata.

```sh
bash scripts/release.sh finalize 0.2.0
```

The script asks whether to **highlight** this release (default: Settings only), then asks **once** whether to run the recommended release battery (default: yes). Skipping requires a reason, recorded in the public manifest. Noninteractive equivalents:

```sh
bash scripts/release.sh finalize 0.2.0 --highlighted --security
# Or, explicitly acknowledging the unrun battery:
bash scripts/release.sh finalize 0.2.1 --quiet --skip-tests "Reason for skipping"
```

`--security` records that security changes are included; it does not imply a semantic major version or automatically highlight the release. Test failures stop finalization. Version edits remain for inspection; no automatic reset/clean occurs. Before retrying, inspect the failure and restore only the script's version edits if appropriate, then commit any fixes, prepare again, and refresh notes. Do not simply rerun against a dirty candidate or label a failing battery as passed. Normal manifest/version/notes validation cannot be skipped.

Finalization bumps package/lockfile versions, tests that candidate, verifies tracked candidate files did not change during tests/commit hooks, creates a local release commit and annotated tag, then creates a **separate** manifest commit pointing at the exact release commit. The target cannot contain its own hash. A local `.git/margin-release.lock` prevents concurrent script invocations; after a crash, inspect its PID, Git state, and existing tag before removing a stale lock or resuming manually. A partially completed release is retained, not silently rewritten.

Nothing is pushed automatically. Review the local commits, tag, notes, images, and test report, then use the printed explicit atomic push command to the official repository. Publishing source, tag, and feed together avoids announcing a commit that has not reached GitHub. Never move published tags or reuse a version for another commit. Authentication, branch protection, and push rejection are handled by Git; this script does not configure or bypass them.

## One release regression battery

```sh
npm run test:release
```

`scripts/release-suites.ts` is the central registry. It runs Node tests; TypeScript, production and recovery builds; ordinary browser workflows; gateway tests; writable connection tests; connection gateway tests; production source-send guards; and older/newer disposable installations. Existing file globs discover new tests automatically; genuinely new suites belong in this registry. A registry regression test detects an unregistered browser configuration.

The runner copies the **current working source**, including eligible new files, into `.margin-data/temporary/release-tests/run-*/app`, with isolated Git history and private runtime configuration. It reuses installed dependency files but does not install into or rebuild the live app. When dependencies change, separately validate a clean `npm ci` in a disposable checkout; this battery is not a fresh-install guarantee. Provider credentials and running-worker identity are excluded from the runner's inherited environment. Each suite runs sequentially; a failure stops the battery and leaves `results.json` recording passed, failed, and not-run suites. The disposable copy and logs remain for diagnosis. Fixed browser fixture ports must be free; the runner never reuses or stops an existing app.

During feature work, use focused tests/checks instead. The full battery is a pre-release recommendation, not a requirement for every edit. Real macOS sandbox enforcement (`npm run test:sandbox` from a normal Terminal), live-provider inference, Safari/mobile keyboards, and human content/privacy review are separate checks—not silently included in an automated pass.

## Quiet versus highlighted

Settings keeps **Margin updates** small and collapsed on each visit. Its summary still shows `v0.1.0 → v0.1.1 available`, or `v0.1.1 · already latest` when the known published version matches. Unknown versions, missing releases, failed checks, and a checkout ahead of the published version have distinct labels; a failed check never claims “already latest.” Expand the row for details, release notes, and update actions. Highlighted header notifications are unchanged.

The manifest records `latest.highlighted` independently of its version and retains `lastHighlightedVersion` across quiet releases.

Example: `0.2.0` is highlighted, followed by quiet `0.2.1`:

- Running `0.1.0`: header shows **Update available**, targeting `0.2.1`.
- Running `0.2.0`: no header badge; Settings offers `0.2.1`.
- Running `0.2.1` or newer: no upgrade offer.
- Unknown/mismatched running identity: Settings offers release review without claiming an installed version or suggesting a downgrade.

The committed initial feed has `latest: null`; it deliberately does not fabricate a public release. Users on versions predating the checker need one manual upgrade before discovery works.

## Discovery and running identity

The gateway (or standalone native host) checks the fixed HTTPS feed at `https://raw.githubusercontent.com/steerbits/margin/main/releases/stable.json`. Workspace workers and browser tabs do not independently contact GitHub. One in-flight request, a six-hour interval with jitter, one-minute manual cooldown, bounded timeout/body size, ETag conditional requests, and retry/backoff keep checks lightweight. The last valid feed and check state live under private `updates/cache.json`. Manual checks respect upstream Retry-After. Startup is not blocked by GitHub.

Invalid/unsupported manifests, offline failures, changed commits under the same version, backwards release pointers, or backwards highlight history preserve the last valid result and expose a Settings notice. Cached results can still advertise an update, with their last-check time. An error is never treated as proof that the installation is current. Release notes URLs are constructed from the official repository and validated commit/version, never accepted as arbitrary remote navigation destinations. The feed trust boundary is GitHub HTTPS and the official repository; cryptographic release-signature verification is not implemented.

**Activating source changes:** pushing/pulling Git commits, restarting, and refreshing do not rebuild `dist`. From this checkout, run `npm run build`, then finish active tasks, stop the existing launcher, run `bash start.sh` with your usual port options, and refresh the browser. If the coding agent has already built this same checkout, only the restart/refresh remain. A different checkout needs its own build.

Vite writes `dist/margin-build.json` and embeds the frontend version. Hosts capture identity at startup, requiring source/build versions to agree in production. Browser/server version mismatches show an unknown-version/restart warning. Editing `package.json` or rebuilding under an existing host does not change its captured identity; a fresh, matching startup and browser refresh are required. This records an upstream baseline, not proof that every customized file is identical to upstream. Development mode captures source version at startup and explicitly labels that limitation.

## Update and Help actions

Clicking **Update available** (or Settings → **Review update**) starts a normal source-workspace conversation and automatically sends a read-only review request pinned to the selected official commit. It asks for changes since the installed version and linked notes, inspection of local work/plugins, and confirmation **before** source edits, dependency installation, integration, or restart. Help likewise autosends its existing read-only opening question. Customization examples still prepare unsent drafts.

Both reuse normal send/checkpoint handling, default model/skill selection, transport idempotency, draft preservation, and the unchanged source-task guard. A running customization task, failed availability check, or failed submission leaves the message saved for explicit retry—not a background queue. Navigation or user editing cancels a pending automatic send. Repeated Update clicks in the same open app reuse the conversation for that exact target; this association is not persisted across app reloads. Loading/reloading a conversation never automatically sends it.

Without configured AI, Update opens official release notes and Help opens GitHub issues, without creating a chat. Configured-but-unavailable model connections fail normally, retaining drafts instead of silently switching providers.

After confirmation the agent should fetch official upstream and integrate the exact selected release, not blindly pull a moving branch or the user's fork. Preserve customizations, private/ignored plugins, Git history and saved data. **A prompt is not an enforced read-only capability or a transactional installer.** Code checkpoints are not full data/plugin backups. Migrations, dependencies, active workers, rebuild, restart and recovery still require explicit care. See [installation preservation](installation.md), [customization checkpoints](customization-workspace.md), and [customized update analysis](customization-updates.md). There is no unattended activation, data-migration coordinator, or automatic rollback guarantee in this release.
