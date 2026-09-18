# Native installation and preservation

This technical beta keeps the existing repository layout. It adds a private Pi directory, bundled cco, a fresh-install script, and a checked start command.

## Existing users

Update source in place. Keep the same `.margin-data`, `.git`, workspace folders, and external project locations. Conversation IDs and the customization workspace path remain unchanged; no path migration is necessary. Source changes take effect on the next rebuild/restart.

After stopping Margin, `bash start.sh` and `npm start` automatically build local source when its version differs from the production build, or the build is missing or invalid. A failed/interrupted startup build is retried on the next start, and a failed build never starts the server. A matching build starts normally without rebuilding. This happens after the checkout ownership and port checks (and the sandbox probe for `start.sh`), so a duplicate launch cannot rebuild beneath the existing launcher. Development mode skips this step. Same-version edits still need `npm run build`; startup does not download releases or install dependencies. Refresh the browser after restarting.

The check compares `package.json` with `dist/margin-build.json` and requires `dist/index.html`; it does not compare Git commits or scan source/plugin files. It also honors `.margin-data/startup-build-pending` under the checkout, which remains after a failed build until a complete retry succeeds. `--help` and `--dry-run` do not build. Explicit legacy entry points such as `start:native` and `start:single-sandbox` retain their manual build workflow. If dependency installation is required by an update, complete it while Margin is stopped before starting again.

Pi now uses `<MARGIN_DATA_DIR>/pi`, defaulting to `.margin-data/pi`. A fresh sign-in through Settings may be required; global Pi credentials are neither moved nor deleted. Existing chats and notes are separate from provider authentication.

The installer is for fresh checkouts. It does not update an already-running installation. Validate source changes in a disposable checkout, finish active work before activation, and keep the previous source/build. Do not run `npm ci` against a running installation, since it replaces dependency files.

## What the installer does

`bash install.sh --start` checks Node 22.19+, npm, Git, and macOS, installs the dependency lock, builds the frontend/recovery tool, runs the real native sandbox probe, and starts the gateway. Node 24 LTS is the tested/recommended runtime line.

`--destination NEW_FOLDER` first copies source and independent Git history into a new directory. It omits private saved data, workspaces, caches, and dependencies. A checkout that still tracks workspace files is refused until they are untracked. This is not a data migration command.

An existing destination is rejected. Existing dependency/build directories are rejected before npm runs. Partial installations are retained after failure. `--prepare-only` finishes installation/build without claiming sandbox validation or starting an agent.

The installer records the chosen port and a separate browser cookie name in the new installation's private data. Existing installations without that file retain their normal port/cookie defaults.

## Ports and duplicate starts

Use `bash install.sh --port 4318 --start` for a fresh installation or `bash start.sh --port 4318` for a one-time override. `npm start -- --port 4318` and `npm run dev -- --port 4318` use the same launcher policy. Start precedence is `--port` > `PORT` > saved installation port > 4317; valid ports are decimal integers from 1024 through 65535.

Before installation/build or a checked start's sandbox probe, Margin tests binding `127.0.0.1`. If the requested port is busy, it checks at most the next **10** higher ports, stopping at 65535. It offers the first available one with a default-no confirmation. Declining, reaching the limit, or running without an interactive terminal exits nonzero with a manual `--port` command. An accepted installation port is saved; a later start's override/fallback is temporary. A port probe cannot reserve the port during a build or sandbox check: startup checks again and reports any final bind failure without printing a success link.

The standard launcher claims one owner per physical checkout **before** offering another port. A second start from the same folder (including via a symlink or with a different `MARGIN_DATA_DIR`) fails with the existing launcher's URL, or a startup-in-progress message. Separate fresh checkouts may run on different ports; keep their private data separate. This does not change the explicit legacy single-server launch commands.

Ownership is stored under the checkout's `.margin-data/launcher/`, independent of a custom data directory. Concurrent claims are serialized, normal exits release ownership, and a verified dead PID allows recovery after a crash. An unverifiable/live PID blocks takeover; elapsed time, laptop sleep, or a lost connection is not proof of death. Do not delete ownership files to force overlapping launches. **Restart the current launcher after updating** to activate this guard; it cannot retroactively register a launcher started by the old version.

## Project repositories

Keep new workspaces outside Margin's source folder, normally under `~/Projects`. Each project can have its own Git repository. The normal gateway rejects registering a new project beneath the app source and avoids opening the chooser in an old nested location. Existing registered nested projects remain available to preserve their paths and conversations.

The installer omits workspaces completely. If an old checkout still tracks workspace files, untrack them without deleting them before making a fresh source copy. Ignore rules alone do not remove already-tracked files from Git.

## Backups

`.margin-data` contains core chats, notes, drafts, uploads, registry information, and native transcripts. Also preserve:

- `.git`, including local checkpoint refs and objects; the checkpoint journal is in `.margin-data`.
- Local projects under `workspaces`, plus external projects. The registry stores references, not their contents.
- Untracked customization source/documents and local configuration.
- The old `~/.pi/agent` directory if you want a separate backup of terminal Pi.
- Docker volumes separately when using a Docker customization.

For a consistent filesystem copy of SQLite data, stop writers first or use a supported database backup procedure. Do not copy only `margin.sqlite` while omitting its active WAL file.

## Validation boundary

The prior isolated prototype passed 189 Node tests, 26 selected browser tests, and 10 gateway tests. A Linux Docker experiment also passed the actual bubblewrap filesystem probe, browser onboarding/workspace creation, and a container-replacement persistence check.

The preparing agent cannot apply another macOS Seatbelt sandbox: `sandbox_apply: Operation not permitted`. Native enforcement still needs `start.sh` from a normal Terminal. A real provider login/inference is a user check. These limits do not justify an unsandboxed fallback.

Docker is documented in [Docker installation notes](docker-installation-notes.md), not implemented as an installer mode.
