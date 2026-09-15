**Updating a customized Margin installation**

Research/design note, 14 September 2026. Applies to localhost and one-owner server installations. The mechanisms below are proposals, not an implemented updater. This extends the [self-hosting recommendations](self-hosting.md).

**Recommendation: preserve customizations as versioned source, use ordinary merging first, and offer AI-assisted adaptation when needed.** A person should be able to customize Margin's core as well as develop plugins. Prefer a plugin or setting when it expresses the change cleanly, while supporting a personal source branch for changes that need core edits. Build and test a candidate release separately, then activate it deliberately. Keep the previous working release and a data-aware recovery path.

AI should make difficult updates more approachable. A successful model response should not be the sole reason an update replaces someone's working installation. Equally, normal updates should not require a working model subscription when no adaptation is needed.

The intended interface is **Prepare update**, a readable behavior report, a preview, and **Install**. Git is the mechanism underneath; owners should not have to learn branch management to preserve a customization.

**There are three different kinds of customization to preserve.**

| Kind                       | Example                                                                     | Update treatment                                                                                         |
| -------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Owner settings and content | Default model, enabled plugins, skills, saved notes                         | Keep outside replaceable application source; migrate supported formats                                   |
| Plugin code                | A project task board, notes actions, a custom result renderer               | Pin plugin source/version, carry it into the candidate build, check the host API and behavior            |
| Core source changes        | Different composer behavior, navigation, transport, or new extension points | Merge upstream changes into the owner's versioned source; adapt conflicts and test the intended behavior |

A plugin is executable code with compatibility requirements. Keeping it in a separate directory prevents accidental replacement by a stock image, but does not guarantee that a new host can run it.

**Margin already has useful pieces, but not an upstream-update model.** Current facts:

- Plugins live under `plugins/<name>`. Server modules load at startup; browser modules are discovered by Vite at build time. Dropping a browser plugin into a volume after building the stock image will not add it to that bundle. See [browser discovery](../src/plugins.ts), [server loading](../server/plugins.ts), and [extension guide](extensions.md).
- Plugins currently declare `apiVersion: 1` in code. The optional `plugin.json` supplies display metadata, not a complete dependency or host-compatibility contract. Some documented plugin imports reach directly into host source, so a file move can break a plugin even when the numeric API version stays unchanged. See [plugin metadata](../server/plugin-management.ts) and [API](../server/plugin-api.ts).
- Enable/disable choices are stored in the source-controlled `margin.plugins.json`. In a distributable self-hosted version, owner preferences should move to persistent configuration. A shipped default and an owner's override should have separate ownership.
- Code checkpoints preserve tracked and eligible new files, without moving the normal Git branch or staging index. Their `commit-tree` call does not supply a parent. These are independent snapshots, not a history of upstream merges. Their local `refs/margin/checkpoints/...` and private journal must both be preserved. See [checkpoint implementation](../server/checkpoints.ts) and [checkpoint behavior](customization-workspace.md). Git only records commit parents when supplied. [Git commit-tree](https://git-scm.com/docs/git-commit-tree).
- Plugin data is keyed by plugin ID and project ID. Disabling a plugin preserves that data; renaming its ID needs a migration. A source rollback does not reverse database changes. See [plugin storage](../server/plugin-storage.ts).

**The available update approaches have different strengths.**

| Approach                                             | When it wins                                                        | Cost or limitation                                                                | Recommendation                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Stock core plus versioned settings/plugins           | Most changes fit extension points                                   | Requires stable host APIs; arbitrary core edits still need another path           | Preferred where the feature fits                      |
| Personal Git branch, merging upstream releases       | Owner changes core behavior and wants to retain those exact changes | Conflicts and behavioral regressions need handling                                | Default for core customization                        |
| Ordered patch series, rebased onto each release      | A maintainer curates a small set of separable patches               | Patches can depend on each other; rebases rewrite history and complicate recovery | Advanced alternative                                  |
| AI recreates features from intent on a fresh release | A large redesign makes an old patch impractical to port             | Can silently omit details; difficult to guarantee equivalence                     | Explicit escape route after showing what would change |

For the personal-branch route, merge the new release into a candidate branch rather than rebasing the owner's active history. This preserves prior commits and successful integration decisions. Git supplies the text-level three-way merge; AI can help where understanding the code or intent is necessary. [Git merge](https://git-scm.com/docs/git-merge).

**Record the old base, the customized version, and the new upstream version.** Consider an illustrative pair of releases:

```text
R1 ───────────────────── R2          upstream release history
  \                       \
   C1 ── C2 ─────────────── M        owner's history after merging R2
```

`C1` and `C2` are owner changes based on `R1`; `M` combines them with `R2`. The next update starts from that integrated history. Preserve which upstream changes were deliberately adapted, superseded, or excluded.

An update record should identify the trusted upstream repository and exact target commit, previous upstream base, owner commit/tree, plugin source hashes and dependencies, lockfile, build/runtime versions, core and plugin data-schema versions, candidate artifact digest, validation results, and previous active release. Version labels help humans; immutable identifiers make the result reproducible.

For existing installations, import the current source into a dedicated customization repository and preserve uncommitted eligible files as a private snapshot/commit. Keep the owner's working branch and staging choices intact. Establish the correct upstream base from installation metadata or verified history; today's checkpoints do not establish it automatically. If the base cannot be established, offer manual base identification or a separately reviewed port of the customizations onto a known release. Preserve the old repository, checkpoint refs, and journal unchanged. A reviewed port establishes a new known baseline; it does not recover the missing ancestry. Do not silently treat unknown changes as disposable.

Git history, source files, and customization intent must survive a Docker image replacement. A remote Git account is optional: a local repository and protected backup are sufficient. Secrets, live application data, ignored build products, and generated project content do not belong in source commits.

**The plugin path needs a little structure before it can make updates easy.** Keep owner plugin sources in persistent storage or their own repositories, independent of the stock release. Maintain a registry that distinguishes upstream-bundled plugins, owner-authored plugins, and locally modified copies of bundled plugins. Initially, edits to bundled plugins belong to the core customization branch and are merged there exactly once. Separately managed plugin forks need their own base and merge history, with their files excluded from duplicate core integration. Copying either over a newer bundled plugin would conceal upstream changes.

For the first implementation, compose a candidate source tree from the selected host version and pinned plugins, then rebuild the browser and backend together. Reject duplicate plugin IDs, including a separately installed plugin shadowing a bundled one, unless the owner selects a documented replacement with an explicit data-compatibility plan. Keep dependency declarations with the plugin and generate a reproducible combined build; don't let an installer silently edit shared dependency versions. Current relative host imports can initially be accommodated by the generated build layout. Over time, expose a stable plugin SDK so plugins do not depend on internal host file paths.

A future plugin manifest should record identity, plugin version, compatible host/API versions, entrypoints, dependencies, and data-schema/migration requirements. Provide a compatibility window and deprecation notes for host API changes. VS Code's extension manifest is a useful precedent for explicit host-engine compatibility; its architecture need not be copied wholesale. [VS Code manifest](https://code.visualstudio.com/api/references/extension-manifest), [semantic versioning](https://semver.org/).

When an enabled plugin is incompatible, keep the working release active. Offer an updated plugin, an adaptation, or installation with that plugin disabled while preserving its data. Do not disable it silently. Fully independent prebuilt browser-plugin loading could reduce rebuilds later, but it needs a new loading/dependency contract and is not required for the first updater.

**Conflict handling must include behavior, not just conflict markers.** The scenarios below are hypothetical examples of how the proposed updater should behave:

| Scenario                                                                                         | Proposed handling                                                                            | Evidence needed                                                                    |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Owner adds a notes-export plugin; upstream changes an unrelated toolbar                          | Carry the plugin into the candidate build                                                    | Plugin loads and exports the expected content                                      |
| Owner changes Enter to insert a newline; upstream moves keyboard handling into another component | Merge, then adapt the change at the new handler if needed                                    | Enter/newline and explicit-send checks, including phone keyboard behavior          |
| Owner edits bundled Notes; upstream adds a storage-revision check                                | Three-way merge that plugin's own base, local version, and upstream version                  | Owner feature still works; stale writes are still rejected                         |
| Plugin calls a host method whose behavior changed without overlapping edits                      | Treat the clean Git merge as only one check                                                  | A representative plugin operation catches the semantic mismatch                    |
| Local code bypasses a check that upstream strengthens to protect private previews                | Explain the incompatible intentions; preserve privacy while offering a revised customization | Unauthorized preview access stays rejected; owner workflow still has a usable path |
| Plugin migration changes stored notes, then the new app fails                                    | Follow the recorded data recovery procedure                                                  | Old code can read the current format, or restore the matching pre-update backup    |

For file conflicts, Git can handle many independent edits. AI may help with moved code, refactors, and changed APIs. For semantic conflicts, even a clean merge needs targeted behavior checks. For intent conflicts, show the owner the concrete choice. For dependency conflicts, reconcile package requirements and regenerate the lockfile with the chosen package-manager version; don't ask a model to hand-edit lockfile integrity fields or update everything opportunistically.

Avoid blanket “keep ours” or “keep upstream” strategies across the app. They can discard the customization or the upstream fix. Git's `rerere` can reuse a previous textual resolution, but reused results still need review and tests. [Recorded conflict resolution](https://git-scm.com/docs/git-rerere).

**AI belongs in an optional adaptation step with a clear input and output.** Give it the old upstream code, owner changes, new upstream code, release notes, relevant API/migration changes, failing checks, and a short statement of why the owner made each consequential customization. Automatically draft that statement from the customization conversation and diff; let the owner correct it when needed. Preserve observable behavior requirements such as “Enter inserts a newline,” rather than relying only on file names that may change.

The AI produces a candidate patch and an explanation of preserved, adapted, and unresolved behavior. It works in a disposable candidate environment, with bounded attempts and no authority to switch production. The updater independently runs the acceptance checks. Keep existing relevant checks intact; changing a failing expectation requires an explanation, not just a green result. Where practical, use a separate reviewer to examine the actual patch and behavior, without treating reviewer agreement as proof.

If model access is unavailable, the owner can still install a compatible update, resolve conflicts manually, or keep the old release. Using the configured provider for an optional adaptation is the intended product experience; the updater's specific provider integration still needs implementation and verification. Code sent to a remote model should be limited to the relevant source/context, with credentials and private runtime state excluded. Build scripts and preview plugins run without production data, production provider tokens, or host-management privileges.

A fundamental redesign may warrant rebuilding a customization from its intent. Offer that as a different proposal with explicit losses and replacement behavior. Do not call it a conflict-free merge. Repeated failures should leave a useful report and the working installation, not an indefinite autonomous rewrite loop.

**Prepare, test, and activate should be separate stages.** The owner-facing flow could be:

```text
Update available
  → Prepare update while current Margin continues running
  → Compatible / needs adaptation / unresolved
  → Open private candidate preview and review behavior changes
  → Install when active work has finished
  → Health check, with recovery available
```

The updater should perform the following work:

1. Capture the exact current source, plugin, configuration, and release state. Lock or detect concurrent customization edits so a stale candidate cannot overwrite newer work.
2. Fetch the selected upstream release from the configured source and create a separate candidate checkout. A Git worktree can separate files, but shares repository metadata; use an isolated copy of the needed Git objects if an AI/build process must not be able to change the active repository's refs. Neither a worktree nor a branch is an execution sandbox. [Git worktrees](https://git-scm.com/docs/git-worktree).
3. Merge core changes, compose the pinned plugins, resolve declared dependencies, and identify migrations. Reconcile the result with the customization intent; don't infer correctness from an empty conflict list.
4. Build a versioned candidate artifact and run relevant core, plugin, and customization checks. Add focused regression cases when a customization lacks a way to detect its loss. Review the actual output of those checks.
5. Offer a private preview using separate test data and enforced filesystem/network isolation. Plugin module loading itself executes code, so removing credentials or setting a flag is insufficient to disable side effects. Keep live databases, secrets, and host-management interfaces inaccessible; restrict outbound access with explicit exceptions for required test integrations. Do not launch real background agents, scheduled work, or model calls by default. If testing with copied data is necessary, use a consistent copy and isolated configuration. This preview isolation is a new requirement, not a feature provided by today's trusted-plugin loader.
6. Present the behavior report and readiness status. Keep unresolved items visible. Successful preparation does not replace the running app.
7. Before activation, hold a customization/activation lock through the final input comparison and cutover. Any changed source, plugin, dependency, or relevant configuration input invalidates readiness: preserve the old candidate, release the lock, prepare again from the latest snapshot, and rerun affected checks. For a current candidate, finish or stop active workers and take a fresh consistent backup. Prevent ordinary writes during the cutover. Journal migration progress durably, use transactional or restartable migration steps where possible, switch the selected artifact, and restart the gateway/workers. Retain stable workspace identities and container paths across versions.
8. Run readiness and critical behavior checks before admitting ordinary work again. Retain the previous artifact and recovery metadata, and expose an independent recovery command. If activation fails, recover according to schema compatibility instead of blindly starting old code on newly migrated data. A crash midway through several workspace/plugin migrations must resume from the journal or restore a consistent backup; it must not leave a partially upgraded installation serving requests.

A useful report for the keyboard example would say: “Your newline-on-Enter behavior was moved to the new composer handler; explicit send and mobile layout checks passed. Notes export remains enabled. No data migration is required.” That is a proposed report format, not an observed update result. When behavior cannot be preserved, show the smallest concrete before/after example and offer **adapt**, **omit this customization for the candidate**, or **keep the current release**.

**Docker should ship the tested result of customization.** Use the published image for a stock installation. For custom plugins or core edits, build a derived, locally tagged release from the exact integrated source and dependency lock. Keep the source repository, owner configuration, plugin source, and live data outside the disposable runtime layer. A plain image pull cannot merge an owner's code changes.

Do not merely bind-mount an old modified source directory over a new image: that can combine old code, a new browser bundle, and mismatched dependencies. Likewise, `docker commit` captures container filesystem changes without preserving the source integration story; it is not the primary update mechanism. Use a reproducible build recipe and record its artifact digest. Private customization code should not be published to a registry without the owner's explicit choice.

Build on the VPS where resources permit; offer a documented way to build on another machine and transfer the artifact when necessary. Core plugins, credentials, and data need not be uploaded to a central Margin service. Use temporary build-secret mechanisms if private dependencies require authentication. [Docker build secrets](https://docs.docker.com/build/building/secrets/).

There is a practical design change for the current Customize feature: it should edit a persistent customization checkout, then prepare a runnable release. The running application should not import half-finished edits during an update. The current gateway recognizes Customize by the application-root path, and checkpoint recovery depends on that root's Git repository. Separate installation identity, customization source, and active artifact explicitly; do not assume changing a directory symlink preserves chats, source history, or recovery. See [gateway registration](../server/gateway.ts), [workspace data routing](../server/workspace-data.ts), and [checkpoint root handling](../server/checkpoints.ts).

For localhost development, retain the direct source-edit/rebuild workflow. The same update preparation and merge records can run locally; changing the distribution model should not force every local developer into Docker.

**Rollback has separate code and data requirements.** Retain the previous image/build, its core/plugin versions, configuration and schema metadata, and the relevant Git objects/checkpoint refs/journal. Include local plugin repositories in backup. Source snapshots alone do not save chats, provider credentials, notes, or all installation metadata.

If old and new code both support the active schema, switching code back can retain newer data. If a migration is incompatible, recovery may require the pre-update backup and can lose writes made after that backup. State that recovery point before activation; prefer backward-compatible migrations where practical. Token rotation, external actions, and changes to other systems may not be reversed by a local restore. Test rollback on a disposable installation rather than promising seamless reversal.

Current plugin storage exposes namespaced reads/writes, not a migration coordinator. Adding declared migrations, version tracking, and crash recovery is implementation work. For an irreversible migration, identify in advance whether failure requires restoring the full installation backup; do not assume restoring only that plugin's records is consistent with the rest of the data.

A small launcher/recovery utility outside customizable source should retain enough state to start the previous release even if the new UI, Pi integration, or dependencies are broken. Margin's existing independent recovery program is a useful foundation, but it currently restores source snapshots; it does not switch deployment artifacts or coordinate data migrations. [Existing recovery](customization-workspace.md).

**Build this in increments.** First record upstream bases and customization source, separate owner preferences, and add candidate builds plus manual conflict resolution and recovery. Next make plugin manifests and compatibility checks explicit. Then add AI-assisted adaptation using the same candidate/update machinery. Runtime-loaded plugin bundles, hosted builders, and automatic feature recreation can wait.

Keep an option to postpone an update with a visible explanation of what is being deferred. Upstreaming broadly useful changes, or turning frequently conflicting edits into maintained extension points, reduces future maintenance. Neither is a prerequisite for an owner's private customization.

**Verification for this document:** current plugin discovery, manifests, storage, source checkpoint ancestry, recovery dependencies, and path-based workspace registration were inspected. Git, Docker, and extension-manifest documentation support the referenced mechanisms. An independent static review challenged legacy import, bundled-plugin ownership, concurrent edits, preview isolation, migration recovery, and Docker/source identity; the clarifications are incorporated above. The worked conflict scenarios are illustrative and the release workflow is a design proposal. No updater, merge prototype, image build, AI conflict-resolution run, data migration, or deployment was performed.
