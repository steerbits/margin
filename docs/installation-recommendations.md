# Installation and update recommendations

Date: 15 September 2026. Updated to require Margin-owned Pi configuration and no separately installed cco. This is a recommendation based on the current source and dependency lockfile. The native minimal installer is now implemented; this document retains the broader design recommendations. See installation.md for current behavior.

**Current first step: [minimal installation for technical users](minimal-installation.md).** Keep `.margin-data/`, add a private Pi directory, and bundle the existing pinned cco code. Technical users provide Node/npm and Git. The broader layout, sandbox extraction, runtime bundling, and managed restart described below are later work, not requirements for that beta.

## Longer-term recommendation

**Yes: users can point their coding agent at an `INSTALL.md` file and ask it to install Margin.** Make that file the entry point to a versioned installer that handles dependencies, configuration, verification, and launch. The agent explains progress and handles exceptions; the installer performs the repeatable steps. Users should also be able to run the same installer directly without an agent.

For the first release, support **local macOS installation**, matching the current native folder chooser and cco integration. Qualify Linux separately. A server distribution has additional requirements covered in [self-hosting recommendations](self-hosting.md); publishing an installation guide does not establish server or Windows support.

The intended experience is:

> “Read this release’s INSTALL.md and install Margin.” → dependencies and app are installed → browser opens → user connects a provider → first conversation works.

Most steps can be automatic. Provider authorization, entering an API key, OS installation dialogs, and any administrator authentication may still require the person. An agent restricted by its host may need to hand the final launch command to the user’s normal Terminal.

**The proposed distribution owns its runtime, Pi configuration, sandbox integration, and persistent state.** Pi stays an internal dependency. Replace the external cco command with a bundled native sandbox adapter, described below. Users install and update Margin as one product. The OS, browser, model service, and tools required by their own projects remain external dependencies; this does not imply offline model inference or a universally portable binary.

## What is the Margin data folder?

The actual setting is **`MARGIN_DATA_DIR`**. It is a directory path supplied to the application, not another service or dependency. Today it defaults to **`.margin-data/` inside Margin’s source folder**.

It stores the information that must survive a rebuild or restart:

| Contents | Purpose |
| --- | --- |
| `margin.sqlite` | Workspace registry, Margin-source conversations, and stored application records such as settings, comments, drafts, and plugin data |
| `workspace-data/<workspace ID>/` | External workspaces’ databases, transcripts, attachments, and runtime state |
| `pi-sessions/` | Native Pi conversation files for the applicable Margin worker; external workers keep these beneath their own data directories |
| `attachments/` | Uploaded files for conversations belonging to that data directory |
| `history/` and `recovery/` | Checkpoint journal and the current independent recovery program |
| Model catalog, browser-connection, and runtime files | Model cache/state, launcher authentication metadata, worker ownership, and diagnostics |

These are logical examples, not a promise that every file is present before first use. Details come from [gateway storage](../server/gateway.ts), [workspace data routing](../server/workspace-data.ts), [attachments](../server/attachments.ts), and [recovery build](../scripts/build-recovery.ts).

**Project files stay in the folders users select.** A project entry in the database is a reference to that folder, not a backup of its contents. Pi credentials currently default to `~/.pi/agent`, separately from `MARGIN_DATA_DIR`. Code checkpoint objects also depend on the source repository’s `.git` data. Browser-only preferences and unsaved browser state are not all captured by copying this directory.

### Proposed self-contained layout

For example, choose one user-owned installation root with separate children:

```text
Margin/
  app/          Source Git repository, plugins, bundled skills, dependencies, build
  runtime/      Managed Node/npm and any bundled tool binaries
  sandbox/      Bundled native helper, policies, supporting files, attribution
  control/      Proposed independent launcher and activation/recovery controls
  data/         Persistent Margin databases, conversations, uploads, runtime state
  pi/           Private Pi credentials, settings, models, skills, extensions
  cache/        Managed package/build caches; disposable where documented
  workspaces/   Optional home for newly created projects
```

The launcher supplies absolute paths equivalent to:

```text
MARGIN_DATA_DIR = <installation root>/data
PI_CODING_AGENT_DIR = <installation root>/pi
```

The Pi variable points **directly at the agent directory**: with this layout, credentials go in `pi/auth.json`, not `pi/agent/auth.json`. Set both paths before creating Pi runtimes and pass them consistently to the gateway, workspace workers, bundled Pi CLI, and relevant build/recovery commands. Users should not have to export them manually in Terminal.

Keep persistent folders outside `app/` so source replacement cannot erase them. Give a normal workspace write access only to its selected project, its own state, private Pi state where refresh requires it, and required temporary/cache paths. Do not grant every worker the entire installation root. Customize Margin should target `app/`; the independent launcher and sandbox helper should remain outside that editable source tree.

This layout is a proposal. The current recovery build writes into `data/recovery/`; the proposed independent controller needs implementation. Relocation also needs explicit support because workspace identities, transcript paths, and checkpoint recovery currently use absolute/canonical paths. A single root makes ownership and backup clearer, but does not make moving it to another machine automatically work.

## What needs installing?

| Component | Current requirement | Recommended installation behavior |
| --- | --- | --- |
| Node.js and npm | Required to install, build, and run Margin | Reuse a tested compatible runtime, or install a pinned runtime in a Margin-owned user directory. The bootstrap must work before Node exists. |
| Pi | Already a local npm dependency: `@earendil-works/pi-coding-agent` is exactly `0.85.1` | Install with the app’s lockfile. A separate global Pi installation or Pi daemon is unnecessary. |
| Other JavaScript packages | React, Express, Pi AI, build tools, and others are in the lockfile | Install automatically with `npm ci`; preserve the release’s resolved versions. |
| Sandbox adapter | Currently an external `cco` executable found through `PATH` | Replace it with a versioned helper included in Margin. No global cco installation or separate cco updates. |
| Sandbox backend | Native macOS uses `sandbox-exec`; native Linux uses bubblewrap | Check that the selected backend actually runs. Linux installation may require an OS package-manager step. |
| Git | Used by source acquisition and Margin’s customization/checkpoint features | Detect it and arrange installation if missing. Preserve a Git repository rooted at the installed Margin source. |
| Shell and basic utilities | Bash and standard OS tools; downloader/archive tools for bootstrapping | Check the supported OS baseline and report any missing tools. |
| Search tools | Pi can use/download `rg` and `fd` | Bundle tested versions for predictable first use, or install them explicitly into Margin-owned storage. |
| Model access | A provider login or API key | Guide the user through **Settings → Provider accounts**. This already exists in the app. |
| Database | SQLite through Node’s `node:sqlite` | No separately installed database server or SQLite CLI is required for the app. |
| Python, uv, compilers, browser automation | Workload-dependent | Add when a project or optional feature needs them. Playwright’s browser binaries are needed for browser tests, not ordinary use of Margin’s UI. |
| Docker | Unnecessary for the recommended native macOS route | Keep it out of the first local installer. Margin’s use of cco’s Docker fallback is currently unvalidated. |

Sources for the current app requirements: [package manifest](../package.json), [lockfile](../package-lock.json), [worker launcher](../server/workspace-workers.ts), [checkpoint implementation](../server/checkpoints.ts), and [provider account setup](provider-accounts.md). Upstream cco documents its native backends and generic `--command` execution; Margin uses the latter to launch Node. It does not need Claude Code merely because it uses cco. [cco documentation](https://github.com/nikvdp/cco#run-arbitrary-commands---command).

## Options for including sandboxing directly

**Yes, Margin can own this integration.** The operating system enforces the restrictions; cco supplies the launch configuration and policy. Its repository already separates the native `sandbox` helper from the larger cco CLI. [Native helper source](https://github.com/nikvdp/cco/blob/master/sandbox).

| Option | What ships inside Margin | Tradeoff |
| --- | --- | --- |
| **Adapt and bundle cco’s native helper — recommended starting point** | A pinned helper and required supporting files, called by Margin’s own worker launcher | Closest to the existing execution path. Margin must maintain its policy and review upstream fixes. |
| Use a sandbox library | A pinned npm dependency such as `@anthropic-ai/sandbox-runtime` | A programmatic API and broader features; requires integration with Margin’s server ports, networking, and concurrent workspace lifecycle. |
| Write a native adapter from scratch | Margin code generating macOS Seatbelt profiles and Linux bubblewrap arguments | Full control, with the greatest implementation and policy-maintenance burden. |

cco’s MIT license permits modification and redistribution with its copyright and permission notice retained. Record the copied revision, local changes, and required supporting files so future fixes can be reviewed. [cco license](https://github.com/nikvdp/cco/blob/master/LICENSE).

The library option is real: Anthropic’s runtime can be embedded without installing its CLI globally. It uses OS sandboxing and network proxies, and is currently labeled a research preview. Its documented prerequisites include ripgrep on macOS and bubblewrap, socat, and ripgrep on Linux. Supply Margin-owned configuration rather than its global CLI settings file. This is an alternative to evaluate, not a tested replacement in Margin. [Library and platform documentation](https://github.com/anthropics/sandbox-runtime).

### Scope of the recommended extraction

Keep an adapter that launches the **entire workspace Node worker**, including Pi, extensions, server plugins, and child processes. Wrapping only Pi’s bash tool would leave in-process file writes outside that boundary. Retain explicit directory grants, valid Git worktree metadata access, environment sanitization, worker identity checks, and reliable Stop/shutdown behavior. Those responsibilities already exist partly in [Margin’s worker launcher](../server/workspace-workers.ts).

The full cco installer, CLI modes for other agents, Docker management, global credential setup, `.env` loading, and self-updater are unnecessary for this native route. Margin should calculate its grants from its own configuration and selected workspace.

**Extracting the helper also requires reviewing its defaults.** The inspected macOS helper allows writes to broad user Library directories. Carrying those exceptions over unchanged could make unrelated application state writable, including the whole Margin installation if placed under Application Support. Replace them with specific required paths and test the resulting behavior. Linux support must also carry the relevant seccomp filter assets. These filters restrict selected system calls; omitting supporting files changes the effective sandbox. [Helper policy and assets](https://github.com/nikvdp/cco/blob/master/sandbox).

Maintain the present distinction between write restrictions and confidentiality: broad reads and network access remain available in the current native design. Merely moving Pi’s configuration does not stop an agent from reading global files. Stronger read/network isolation is an additional policy decision.

On macOS, the helper still relies on the OS’s `sandbox-exec`. Apple’s installed manual marks it deprecated, so qualify supported macOS releases rather than promising indefinite compatibility. On Linux, bundle or arrange installation of bubblewrap and verify the host allows the required user namespaces; distributing a binary cannot supply unavailable kernel permissions. Bubblewrap’s protection also depends on the policy its caller constructs. [Bubblewrap requirements and policy](https://github.com/containers/bubblewrap#user-namespaces).

If sandbox startup fails, report it through diagnostics and keep the worker stopped. Validate the replacement on real supported hosts before removing cco. This is more than copying a file, but it does not require inventing an OS sandbox.

### Fix the Node requirement before distribution

The root manifest and README say **Node 22.13+**, but both locked Pi packages declare **Node >=22.19.0**. The installer must satisfy the dependencies’ requirements, not only Margin’s current declaration. There is also an optional Linux x64 development dependency, `@napi-rs/lzma-linux-x64-gnu`, declaring `^22.20 || ^24.12 || >=25`; verify platform-specific packages when qualifying Linux.

**Recommendation: test and pin a current Node 24 LTS patch for releases.** Node 24 is currently an LTS line. Do not interpret this recommendation as a completed compatibility test. The inspected workstation runs Node 25.5.0; the official release table now lists Node 25 as end of life, so copying this workstation’s runtime is a poor release default. [Node release status](https://nodejs.org/en/about/previous-releases).

### Preserve today’s runtime packaging requirements

The README’s current sequence is:

```sh
npm ci --ignore-scripts
npm run build
npm start
```

For an installer, explicitly include development dependencies during installation, including when the surrounding environment sets `NODE_ENV=production`. **Do not use `npm ci --omit=dev` with the current layout:** `tsx` is a development dependency but is used at runtime, and build tooling is also needed. Keeping these dependencies is the simplest first release; compiling the backend and changing runtime dependency placement can be a later packaging improvement.

Retain `--ignore-scripts` only after verifying fresh installation and required native/optional packages on every supported platform. It suppresses dependency installation scripts; explicit commands such as `npm run build` still run. Use the lockfile rather than asking the agent to regenerate it when installation fails. [npm ci behavior](https://docs.npmjs.com/cli/v11/commands/npm-ci/).

## Can the installation be just a Markdown file?

**For an early technical audience, yes.** A complete Markdown guide can tell a capable agent how to inspect the machine, install prerequisites, fetch a tagged release, build it, launch it, and diagnose errors. That is a useful first distribution format.

For a dependable public release, put the operational details in scripts. Prose alone leaves each agent to interpret versions, paths, retries, and success differently. A Markdown file also cannot execute itself, supply missing permissions, or guarantee unattended sign-in.

Recommended proposed files:

| File or command | Responsibility |
| --- | --- |
| `INSTALL.md` | Short instructions for people and agents: supported platforms, exact release, installation command, login, success criteria, and troubleshooting. |
| `install.sh` | Bootstrap without Node, acquire the release and dependencies, configure the installation, and arrange the launcher. |
| Release manifest | Exact Margin revision, Node/npm versions, Pi versions, bundled sandbox revision, supported platforms, and download checksums. |
| `margin doctor` | Diagnose runtime paths, versions, storage access, build output, port conflicts, and actual worker startup. |
| `margin start` | Set the installation’s stable paths and environment, start the existing gateway/workers, and present the browser connection link. |

These names describe proposed interfaces; none of these new commands currently exists.

Keep `INSTALL.md` and its installer tied to the same release. The guide should tell an agent to use the provided commands, preserve existing source changes, and report the exact failed step rather than improvising dependency upgrades or disabling cco. An agent need not create or install a special skill just to follow this file.

## What the installer should do

1. **Inspect the machine.** Check OS/architecture, usable Node/npm and Git, the native sandbox, writable installation/data paths, and the default port, 4317. Identify an existing Margin installation and any local customization before changing it.
2. **Provide missing prerequisites.** Download a tested Node distribution into user-owned storage when needed, verifying it against trusted release metadata. Use the OS’s supported Git/backend installation route when necessary. Do not replace the person’s system Node or rewrite their global package-manager setup.
3. **Acquire an exact Margin release.** Fetch a named tag/commit over HTTPS. Preserve source and Git history for Customize Margin. Include the tested sandbox adapter and supporting files in the release, and select the qualified native backend explicitly.
4. **Install and build.** Install locked dependencies with development tools included, then build the frontend and recovery helper. Do this in a new installation or staging location; `npm ci` removes that location’s existing `node_modules` and should not run against an active installation.
5. **Set durable paths.** Configure `MARGIN_DATA_DIR` outside replaceable source, including during the build, which writes the recovery helper there. Save configuration in user-owned storage and have the launcher supply it consistently.
6. **Verify and launch.** Check actual sandbox execution, start a workspace, and confirm the app can persist state and serve the browser. Then show/open its authenticated connection link. Distinguish “installed” from “provider connected and first reply verified.”
7. **Finish provider setup.** Use the existing Settings flow. If terminal recovery is needed, invoke the release’s local `node_modules/.bin/pi` CLI using its configured runtime and Pi directory, then use `/login`. Avoid fetching another Pi version through an unqualified `npx` command.
8. **Make repeat installation predictable.** Re-running for the same release should reuse completed steps and preserve chats, credentials, projects, and customizations. A different release should enter a distinct update procedure. Uninstall should remove Margin-owned program files and preserve user data by default.

**Do not run cco’s upstream installer as part of the proposed distribution.** It currently clones or updates the moving `master` branch, can modify a shared installation, and may use `sudo` for a symlink. Include the selected native components in Margin’s own release instead. [cco installer source](https://raw.githubusercontent.com/nikvdp/cco/master/install.sh).

Installing Node in a Margin-owned directory solves the bootstrap without needing Homebrew or a global Node version-manager change. The launcher must make that runtime available to npm, the sandbox adapter, and child tools; a terminal’s interactive shell configuration is not a reliable substitute. The current worker launcher already uses the gateway’s absolute Node executable. [Launch implementation](../server/workspace-workers.ts).

For v1, retain a stable source location so customization history and workspace identity stay consistent. Introducing version directories and a `current` symlink requires more design: Margin currently uses canonical application paths in workspace registration and checkpoint handling. See [customization update recommendations](customization-updates.md).

## If Pi updates, will Margin break?

**A new Pi release does not automatically change Margin’s embedded Pi.** Margin imports its locally installed SDK, and `pi-coding-agent` is pinned to `0.85.1`. The lockfile also currently resolves the directly used `pi-ai` package to `0.85.1`.

There are nevertheless several distinct update risks:

| What changes | Effect on Margin |
| --- | --- |
| Upstream publishes a new Pi version | No automatic replacement of the installed SDK. |
| User updates their global `pi` command | Does not replace Margin’s SDK; changes made by terminal Pi to shared configuration or resources can still affect Margin. |
| User updates global cco | Can change the next workspace launch today, because Margin resolves `cco` through `PATH`. The proposed bundled native adapter removes this dependency. |
| Someone updates dependencies or regenerates the lockfile | Can change package versions. The direct `pi-ai` declaration is currently `^0.85.1`, so a fresh resolution can select a later compatible-range version. |
| Margin deliberately upgrades its embedded Pi | Can require changes to its SDK adapter, dialogs, events, authentication integration, or session handling. |
| A provider changes authentication, model availability, or service behavior | Can affect a pinned installation without any npm package changing. |
| A loaded Pi extension or project configuration changes | Can affect Margin independently of the SDK pin. |

The app has meaningful SDK integration in [sessions](../server/sessions.ts), [UI bridging](../server/ui-bridge.ts), [transcript conversion](../server/transcript.ts), [models](../server/models.ts), and [provider accounts](../server/provider-accounts.ts). Its [compatibility matrix](compatibility.md) is specifically for Pi 0.85.1. Pinning is a way to control when this integration is upgraded; it is not a guarantee that every later Pi release is compatible.

### Reduce shared configuration surprises

Today, Margin normally shares `~/.pi/agent` with terminal Pi, including credentials, settings, models, and global resources. Margin’s native conversation transcripts are stored under its own data directories. [Current account storage](provider-accounts.md), [session setup](../server/sessions.ts).

**Require a dedicated Pi agent directory** for the self-contained distribution, supplied through `PI_CODING_AGENT_DIR` as shown above. Keep provider credentials, Pi settings, models, installed resources, and tool downloads in Margin-owned storage. Sign in through Margin; do not symlink to the global credential file or fall back to it when a private login is missing.

**Setting the environment variable is necessary but insufficient for complete configuration independence.** The installed Pi 0.85.1 package manager also discovers `~/.agents/skills` independently of the Pi directory and has a legacy fallback for globally installed npm resources. Its context loader traverses ancestor instruction files. Configure or adapt discovery so the supported default sources are Margin’s bundled/private resources and the selected project’s intended resources. Review provider environment variables inherited from the parent shell too: API keys can supply a connection independently of the private credential file. Make external integrations intentional and test this with a populated global Pi/agent environment.

Allow deliberate import of selected skills/settings where useful, with an explicit choice about future synchronization. Project-local `.pi` resources and project instructions can remain supported; loading a selected project is different from silently inheriting unrelated home-directory resources. Do not change the user’s real `HOME` globally to accomplish this: Git, SSH, and project tools have their own configuration expectations. A private Pi directory does not make every tool’s configuration private.

Normal installation should allow Pi to write credentials and refresh tokens. Do not set `MARGIN_AUTH_READ_ONLY=1` by default: that disables in-app account changes and token refresh. Keep secrets out of installer reports and published release files.

## Recommended maintenance policy

**Ship a tested combination of Margin, Node/npm, Pi, and the bundled sandbox adapter. Let Margin’s release process manage that combination.**

- Keep both direct Pi dependencies at explicit tested versions and commit the lockfile. Pin the sandbox implementation by revision and Node/npm by release metadata.
- Record the versions actually installed and expose them through diagnostics. Resolve managed tools predictably instead of relying on unrelated global upgrades.
- Review upstream changes regularly. Prepare upgrades in a separate candidate; test SDK integration, authentication/refresh, dialogs, streaming/tools, Stop, saved-session resume, skills/plugins, and sandbox behavior before publishing.
- Preserve local customization through the proposed [customization update workflow](customization-updates.md). An installer that overwrites source during “repair” would undermine a core Margin feature.
- Finish or stop active work before activation. Preserve the prior build and a consistent backup of Margin data, source/history, and necessary configuration. Code rollback alone may not read data migrated by a newer release; test recovery for that case.

Users should normally update **Margin**, and receive its tested dependency changes with it. They should not have to coordinate separate Pi and cco upgrade schedules.

## Other pieces needed for a self-contained experience

- **Managed launch and activation:** ship the independent launcher proposed above. After customization, offer **Apply changes** in the browser: prepare a candidate, finish active work, save drafts, restart, and reconnect to the same conversation. Preserve the previous working version and a data-aware recovery path. Today’s launcher runs the gateway in its own process, so this controller still needs to be built.
- **A predictable toolchain:** include Node/npm and the tools the advertised baseline uses. Pi can currently download missing `rg`/`fd` binaries, sometimes resolving current upstream versions; bundle or explicitly pin them if first use must be reproducible. Keep customization build tools available. Git remains required by today’s checkpoint implementation; the installer can provide/check it, or a fuller distribution can bundle it for supported platforms.
- **Owned caches and package storage:** direct supported package/build caches into `cache/` and Pi-managed resources into `pi/`. Check npm user configuration/global-prefix inheritance. Project-specific languages and libraries still belong to those projects; a single installer cannot anticipate every future coding task.
- **Complete backup/export:** include `data/`, `pi/`, custom source/plugin changes, the Git objects/refs needed by checkpoints, and installation metadata. Back up external project folders separately. Take consistent database backups or stop writers first. Ordinary uninstall should preserve this material.
- **One setup flow:** install → open Margin → connect provider → start conversation. Keep a local Pi CLI for diagnostics with the same private configuration. A desktop shortcut or launch-at-login integration can remove normal Terminal use once the controller exists.
- **A clean-machine acceptance check:** launch with global Pi/cco absent, no preexisting provider credentials, and no interactive shell setup. Separately test with conflicting global tools/configuration. Verify the installer uses only the intended Margin-managed runtime and resources, then exercise first reply, restart, update, recovery, and real sandbox behavior.

The resulting promise should be: **“Install Margin once; Margin manages its own runtime, agent configuration, sandbox integration, and updates.”** The browser, OS capabilities, provider account/network, and explicitly selected host projects remain part of the environment.

## What would it take to ship?

The existing Pi SDK and workspace-worker architecture can be reused. The expanded scope includes private resource discovery, native sandbox extraction, dependable bootstrapping, lifecycle handling, and clean-machine verification; it is more than wrapping the current commands in an installer.

| Stage | Scope | Rough planning allowance |
| --- | --- | --- |
| Agent-readable beta guide | Accurate requirements, tagged source installation, existing commands, provider login, troubleshooting | About a day, including a fresh-machine walkthrough |
| Dependable macOS installer | Managed prerequisites, private Pi discovery/configuration, bundled sandbox integration, stable launcher, diagnostics, repeat installation, failure recovery | Several engineering days or more, plus real-host sandbox and architecture/macOS testing; extraction and managed activation add scope |
| Supported Linux/server distribution | Backend qualification, folder-selection alternative, packaging/service lifecycle, server access and persistence | Separate work, likely additional days to weeks depending on the hosting scope |

These are estimates, not tested delivery commitments. A polished automatic updater is additional work; the first public beta can have a documented manual update procedure.

Before calling a platform supported, verify installation on a machine without Node, Pi, cco, or saved credentials; repeat installation; dependency/version conflicts; paths containing spaces; failed downloads and occupied ports; actual sandboxed worker startup; login and a real reply; restart/persistence; and preservation of customizations/data during an update. Port the existing real-sandbox probe to the bundled adapter and cover unrelated installation paths, symlinks, child processes, Git worktrees, and sibling workspace data.

Use the existing `npm test`, `npm run build`, `npm run test:e2e`, and `npm run test:gateway` as release checks. Run `npm run test:sandbox` from a normal host environment and exercise the real per-workspace launcher: fake cco in automated tests does not establish OS enforcement. The existing `npm run probe` is a live OpenAI subscription request, so keep it an intentional maintainer check rather than a provider-neutral prerequisite for every user.

**Longer-term deliverables after the [minimal beta](minimal-installation.md):** a macOS installer with managed dependencies, diagnostic commands, private resource discovery, an adapted sandbox helper, and browser-driven customization activation through an independent controller. Qualify Linux/Docker and customization-aware upstream upgrades separately.

### Verification of this recommendation

Inspected the current source, package and lockfile versions, installed Pi path/resource/tool handling, cco installation/native-helper behavior, existing tests, and related project documentation. Checked current upstream Node, npm, Pi SDK, cco, bubblewrap, and Anthropic Sandbox Runtime documentation. No installation, extraction, build, live model request, sandbox probe, application restart, or dependency change was performed for this document.
