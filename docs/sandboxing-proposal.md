# Whole-server cco integration

Decision recorded September 10, 2026: use cco's default behavior around the whole Margin server. Direct project edits remain enabled. This replaces the earlier isolated-copy/review proposal.

## How it works

```text
cco → Node/tsx → Margin server → Pi SDK → tools, extensions, child processes
                    ↕
             Browser HTTP/SSE
```

Pi remains embedded through its SDK. cco wraps the process that imports and runs the SDK, so no Pi CLI conversion or streaming rewrite is needed. HTTP and SSE continue over cco's normal network access.

The launcher uses cco's generic command support, conceptually:

```sh
cco --add-dir="$HOME/.pi" --command node node_modules/tsx/dist/cli.mjs server/index.ts
```

The actual launcher uses absolute paths, argument arrays, explicit runtime environment settings, and the selected project as cwd. It does not enable `--safe`, restrict the network, make copies, add Apply/Discard, or insert command approvals. [cco documentation](https://github.com/nikvdp/cco).

## Start

From Margin's repository in a normal Terminal:

```sh
npm run build
npm start
```

`npm run start:sandbox` is an alias. `npm run dev` uses the same cco wrapper with the development watcher. Explicit direct-launch commands remain available as `npm run start:native` and `npm run dev:native`; the sandboxed commands never fall back to those automatically.

Inspect the command without starting anything:

```sh
npm start -- --dry-run
```

Choose a primary writable project or additional folders:

```sh
npm start -- --project /absolute/path/to/project
npm start -- --add-dir /absolute/path/to/another-project
```

The default primary project is Margin's source folder. Its nested `tool-smoke` folder is therefore included. For an external project, Margin's code can remain read-only while `.margin-data` stays writable. Existing project entries and chats are preserved.

## Scope

All sessions in one server share the same cco envelope: the primary project plus explicitly added folders and the usual cco state/temp exceptions. This is not per-chat isolation. The normal native backend reads other host files and allows network access; the normal writable project can be modified or deleted directly, as requested.

The launcher adds the Pi state location, matching cco's Pi-mode convention (`~/.pi`, or a configured `PI_CODING_AGENT_DIR`), so OAuth refresh and Pi state work. It also grants Margin's data directory when it is outside the primary project. This is cco's normal `--add-dir` mechanism.

Opening a project in the browser does not widen a running OS sandbox. The UI identifies projects outside the explicitly granted write paths; restart with `--add-dir` to permit writes there. This display is informational; cco and the OS enforce the actual policy, including cco's additional default exceptions.

Because the complete server is inside the sandbox, requests handled by its API execute under that same boundary. No separate privileged worker/host split is introduced.

cco normally selects native Seatbelt on this Mac. Its Docker fallback uses a different filesystem/runtime environment and has not been validated for this installation; a Docker deployment may need an appropriate Node version and Linux-compatible dependencies. [cco security model](https://github.com/nikvdp/cco/blob/master/SECURITY.md).

## Verification and the current host limitation

The development host itself prevents applying another Seatbelt sandbox. A harmless `cco --command /usr/bin/true` invocation exited with:

```text
sandbox-exec: sandbox_apply: Operation not permitted
```

The user confirmed this inherited restriction. No workaround or alternate sandbox escape was attempted. Launcher tests use an explicitly fake cco process to verify failure propagation; those tests do not establish OS isolation.

Run this from your normal Terminal to test the actual native boundary:

```sh
npm run test:sandbox
```

It creates disposable inside/outside fixtures under `.margin-data/cco-checks`, then verifies that cco allows outside reads and inside writes but blocks outside writes, writes through an escaping symlink, and deletion by a child Node process. All fixtures belong to this test and are removed afterward.

The application reports `cco sandbox` only when launched with the wrapper's metadata. This reports the launch path, not independent security attestation. Until the existing native process is replaced from a normal Terminal, that existing instance remains native.
