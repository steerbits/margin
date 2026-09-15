# Native installation and preservation

This technical beta keeps the existing repository layout. It adds a private Pi directory, bundled cco, a fresh-install script, and a checked start command.

## Existing users

Update source in place. Keep the same `.margin-data`, `.git`, workspace folders, and external project locations. Conversation IDs and the customization workspace path remain unchanged; no path migration is necessary. Source changes take effect on the next rebuild/restart.

Pi now uses `<MARGIN_DATA_DIR>/pi`, defaulting to `.margin-data/pi`. A fresh sign-in through Settings may be required; global Pi credentials are neither moved nor deleted. Existing chats and notes are separate from provider authentication.

The installer is for fresh checkouts. It does not update an already-running installation. Validate source changes in a disposable checkout, finish active work before activation, and keep the previous source/build. Do not run `npm ci` against a running installation, since it replaces dependency files.

## What the installer does

`bash install.sh --start` checks Node 22.19+, npm, Git, and macOS, installs the dependency lock, builds the frontend/recovery tool, runs the real native sandbox probe, and starts the gateway. Node 24 LTS is the tested/recommended runtime line.

`--destination NEW_FOLDER` first copies source and independent Git history into a new directory. It omits private saved data, workspaces, caches, and dependencies. A checkout that still tracks workspace files is refused until they are untracked. This is not a data migration command.

An existing destination is rejected. Existing dependency/build directories are rejected before npm runs. Partial installations are retained after failure. `--prepare-only` finishes installation/build without claiming sandbox validation or starting an agent.

The installer records the chosen port and a separate browser cookie name in the new installation's private data. Existing installations without that file retain their normal port/cookie defaults.

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
