# Automatic update discovery and updates through customization chat

Design note, 16 September 2026. This records the proposed first version; no update checker, header notification, or automatic installer is implemented by this document. “Automatic” refers to discovering releases. Changing the installation starts with a user request.

## Direction

Margin checks for a published release, shows its version and release notes in the header, and offers an action that opens a new **Customize Margin** conversation with an update prompt. The agent integrates the release while preserving local customizations and plugins, explains consequential choices, and runs the relevant checks.

Use the normal customization workflow for checkpoints, conversation history, model selection, conflicts, recovery, and eventual rebuild/restart support. Improvements to those shared capabilities should improve ordinary customization and updating together. A separate agent conversation system or deployment pipeline is not required for this first version.

This changes the earlier [customized-installation update proposal](customization-updates.md): a dedicated **Prepare update → preview → Install** workflow is a possible later direction, rather than the initial product requirement. Its technical analysis of merging, plugins, and data recovery still applies.

## How the header discovers a release

**Recommended default: periodically fetch a small JSON file hosted in the upstream GitHub repository over HTTPS.** This is an ordinary HTTP request for metadata; checking does not run `git pull`, fetch source objects, modify files, or start an agent.

For example, the configured public upstream could publish:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/releases/stable.json
```

The repository and path are placeholders. Configure the official upstream explicitly; a user's `origin` may point to their own fork. The initial proposal assumes a public release feed. Private-repository authentication would be a separate requirement, and must not be inferred from a user's model-provider login.

An illustrative manifest, with an invented version and commit:

```json
{
  "schemaVersion": 1,
  "channel": "stable",
  "version": "0.2.0",
  "tag": "v0.2.0",
  "commit": "0123456789abcdef0123456789abcdef01234567",
  "publishedAt": "2026-09-16T12:00:00Z",
  "releaseNotes": "Adds an example feature and fixes an example issue.",
  "releaseNotesUrl": "https://github.com/OWNER/REPO/releases/tag/v0.2.0"
}
```

The short notes are enough to populate the header popover; the link opens the full notes. Treat notes as display content, never as commands or authority to change the update procedure. Validate the schema, field lengths, version, commit format, and expected upstream URLs before accepting a response.

The release maintainer publishes the tested source and tag first, then updates the manifest to reference that exact commit. The manifest update is a separate later commit, so the target commit does not need to contain its own hash. A release script or CI job can eventually generate this file from release metadata. Publish only deliberately released versions to the stable feed; every push to the development branch should not become an update notification.

### Polling and caching

The installation's gateway/server owns one shared check and cache. Individual browser tabs and workspace workers do not each contact GitHub.

- On startup, show any cached result immediately and check in the background if it is older than six hours. Never hold up app startup for GitHub.
- While running, check about every six hours, with a small random offset. After sleep or reconnection, make at most one overdue check rather than replaying missed intervals.
- Offer **Check for updates** for an explicit refresh. Coalesce simultaneous requests and impose a short cooldown, such as one minute.
- Use a bounded request timeout and response size. Persist the last valid manifest, last successful check time, and HTTP cache validators in the installation's private data directory.
- When supplied by the endpoint, reuse `ETag` / `If-None-Match`, or `Last-Modified` / `If-Modified-Since`. A `304` keeps the cached manifest and refreshes the successful-check time. Honor server cache and retry instructions.
- Network failures or malformed responses preserve the last valid result and back off. The popover can show “Last checked…” or “Couldn't check for updates”; a failed check must not claim the installation is current. A missing feed should not trigger rapid retries.

These intervals are proposed defaults, not measured requirements. Browsers receive normalized update status through the existing app connection, or read a small local status endpoint. The exact transport is an implementation choice; it should reuse existing app infrastructure where practical.

**Alternative: use the GitHub Releases API** at `GET /repos/{owner}/{repo}/releases/latest`. It supplies release metadata and notes and can avoid maintaining a separate manifest if GitHub Releases is already the publishing workflow. Public release information can be read without authentication. See the [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release). Resolve the release tag to an exact commit before creating an update task; do not assume a branch-like `target_commitish` value is an immutable source identifier.

The static manifest is the proposed default because it gives Margin an explicit stable-channel pointer and exact source commit in one small response. The API is a credible alternative, not a second feed to poll alongside it. For API polling, GitHub recommends conditional requests and respecting retry/rate-limit responses; its documented primary-rate-limit exemption for unchanged responses requires authentication. See [GitHub's REST API practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api). Do not assume those API quota rules also describe the raw-file host.

## Which version is installed?

Track the upstream release underlying the **running build**, separately from the latest advertised release and the source currently being edited. Local customization commits do not, by themselves, make the upstream release newer or older.

The proposed build/activation metadata should identify the upstream version and commit plus the actual customized source/build identity. This is new work: today's package version and installation settings do not establish a reliable upstream baseline for every customized installation.

- Compare valid stable versions using semantic version ordering, not text ordering. Offer an update only when the advertised version is newer than the known running upstream version.
- Do not announce a downgrade when someone is running a newer version. Unsupported channels or an unknown baseline should show “Version not identified” and allow review of the published release, rather than assert that an update is needed.
- A different commit advertised under the same version is a changed release identity, not an ordinary version upgrade. Surface it for inspection instead of silently replacing the selected target.
- Source changes and a green build mean **ready to restart**, not **installed**. Update the reported running identity after successful activation and startup checks. If the running code is restored, its reported identity must follow the restored build, even if private update records still mention a later attempt.

## Header and chat experience

Illustrative flow:

```text
Header: New version available · v0.2.0
  → Popover: release notes, last checked time, full-notes link
  → [Update with agent]
  → New Customize Margin chat: “Update Margin to v0.2.0”
  → Prefilled draft; user can add priorities and click Send
  → Normal checkpoint → agent work → checks → result / restart instructions
```

Prefilling is the initial direction discussed with the user. It does not send the message, spend model tokens, or modify source by itself. The user can add “keep my custom keyboard shortcuts” before sending. This is a convenient update entry point, not yet a promise of a single-click completed installation.

If one-click execution is wanted later, the same action can create and submit the chat through the normal send path, with wording that clearly says it starts agent work. It must retain checkpointing, busy checks, and retry protection. No separate hidden agent run is needed.

Store the selected repository, version, commit, and release context with the draft/task so a later feed refresh cannot silently change its target. Avoid duplicate update conversations from repeated clicks where practical; link back to an existing unfinished task for that target. Use the normal provider/model settings and skill behavior. A selected skill may introduce a planning checkpoint, so do not imply every update proceeds unattended.

Suggested prefilled instructions:

> Update Margin to **{version}**, exact commit **{commit}**, from **{configured upstream repository}**. Explain the relevant release changes and inspect my local customizations and plugins before editing. Integrate this selected release while preserving my customizations, including uncommitted work. Verify the target source matches the selected commit; do not silently substitute the latest branch tip. Use Margin's shared checkpoint and recovery workflow. If preserving a customization requires choosing different behavior, ask me. Run the relevant build, core, plugin, and customization checks. Summarize what changed, what passed, what remains unresolved, and whether dependency installation, rebuild, or restart is still required. Do not interrupt active work or claim the new version is running before activation is verified.

Attach release notes as context, clearly separate from these task instructions. The agent should use the old upstream base, current local changes, and selected new release when available. Ordinary merging can handle independent edits; the agent can adapt moved code or changed APIs. A clean merge or successful compilation alone does not establish that a customization still behaves as intended.

For example, moving a user's newline-on-Enter behavior into a redesigned composer is adaptation. Discarding that behavior because upstream now has different defaults is a user decision. Similarly, an incompatible plugin should lead to an explanation and a repair or explicit choice, not silent deletion or disabling.

## Shared capabilities and current limits

The existing [customization workspace](customization-workspace.md) already provides the source chat and History interface. Source-workspace sends [save or reuse a checkpoint before the agent receives the message](../server/index.ts); simply opening a draft does not create that checkpoint. Reuse this path rather than asking the model to remember to make the only backup.

The first UI change can be small, but the recovery promise must match the shared machinery:

| Shared capability | Current boundary and proposed improvement |
| --- | --- |
| Code checkpoints | Preserve eligible source files, including plugin code. Associate the starting checkpoint with the update conversation and selected release so the user can find it reliably. This explicit association is not present today. |
| Git integration and retry | Source restore leaves the ordinary branch and index unchanged. If an update merged upstream, restoring old files does not erase that merge from Git history. Preserve integration/base records and account for restored source when retrying; another plain pull may otherwise report nothing to do. |
| Settings and saved data | Source checkpoints exclude chats, notes, credentials, and other private runtime data. Any update that changes their formats needs a compatible migration and data-recovery plan. Existing code rollback is not a database rollback. |
| Plugins | Preserve source, enablement choices, identity, and stored data; check behavior against the new host. Browser plugins participate in the build and server plugins load at startup. Their presence on disk is not a compatibility guarantee. |
| Build and activation | Reuse or improve a general customization rebuild/restart action. Today's documented workflow still requires rebuilding and restarting. Do not replace dependencies beneath running workers or restart while active tasks need them. |
| Recovery when the UI breaks | Keep an independent recovery route available. Today's standalone recovery tool restores source snapshots; dependencies may need reinstalling and the app needs rebuilding/restarting. It does not coordinate release activation or database recovery. |

See [checkpoint behavior and limitations](checkpoints.md), [installation preservation](installation.md), and the broader [customized-update analysis](customization-updates.md). A prompt describes desired agent behavior; it does not implement missing recovery or activation guarantees.

An unavailable model connection should leave the draft and installation intact so the user can connect a provider, retry, or update manually. Discovery itself requires no model call. Unresolved adaptation should leave a useful chat report and recovery instructions, not an indefinite repair loop or an unsupported claim that updating succeeded.

## Proposed implementation order and evaluation

1. Establish the public upstream feed, release publishing convention, and running-build identity. Add cached server-side discovery and the header popover.
2. Open a normal customization draft pinned to the chosen release. Preserve existing send guards, checkpointing, and provider/skill behavior.
3. Improve checkpoint/task association, integration records, recovery, and checked rebuild/restart through the shared customization workflow. Keep activation manual where those shared capabilities are not ready.

Before implementing a completed-update promise, exercise these cases:

| Case | Expected result |
| --- | --- |
| Two tabs, multiple workspaces, an unchanged manifest | One installation-wide check; cached or conditional responses; no duplicate model runs. |
| Offline startup, invalid JSON, or missing feed | App remains usable; last valid information is retained and its age visible; retries are bounded. |
| Known current version, newer release, older release, or unknown baseline | Accurate badge state, no downgrade suggestion, no invented installed identity. |
| Release changes after opening the draft | The existing task keeps its selected exact commit. |
| Uncommitted core edit and a custom plugin | Checkpoint precedes agent work; changes survive integration and relevant behavior checks pass. |
| Update succeeds in Git but breaks a plugin; user restores and retries | Recovery restores the intended source, identifies any dependency/data work, and does not mistake Git ancestry for a completed retry. |
| Build passes but restart is deferred or fails | UI reports pending activation or failure, not successful installation. |
| Update needs a data migration | Recovery requirements are explicit; a code checkpoint is not presented as sufficient. |

Verification for this note: inspected the current source-send checkpoint gate, source restore implementation, installation configuration, and existing customization documentation; checked GitHub's release API and polling guidance. The manifest, intervals, metadata, prompts, and UI above are proposals. No polling, merge, model run, migration, build, or restart was performed for this documentation task.
