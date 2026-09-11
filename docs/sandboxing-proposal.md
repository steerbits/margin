# Per-workspace cco execution

Updated September 11, 2026: the user authorized opening arbitrary project folders and wrapping each selected workspace with cco. This supersedes the earlier whole-server shared boundary.

```text
Browser → local gateway (folder chooser, registry, HTTP/SSE proxy)
                       ├─ cco → workspace A server → Pi SDK, tools, plugins
                       └─ cco → workspace B server → Pi SDK, tools, plugins
```

One worker serves the chats in a workspace. Pi remains embedded through its SDK, and the existing HTTP/SSE, tool, dialog, inline-comment and backend contracts remain intact. The gateway does not import Pi sessions or executable server plugins. Switching folders no longer requires relaunching Margin with a broader write grant.

## Folders and Git

Open any locally writable folder, including an existing Git repository. The **New workspace** action opens the macOS native folder dialog for both opening and creating folders. Use its **New Folder** button to create a project where you want it. `MARGIN_WORKSPACE_PARENT` can supply an initial chooser location. No Git repository is initialized automatically, no project is cloned into Margin, and existing folders are not relocated. Each project can maintain its own Git history. Existing nested `workspaces/` folders remain usable and ignored by Margin's Git history, and the native dialog lets you create projects independently elsewhere.

`npm start -- --project /path` selects an initial workspace; repeated `--add-dir` arguments pre-register workspaces. These are separate worker scopes. The previous single-server launcher remains available explicitly as `npm run start:single-sandbox`.

## Worker launch

Each worker is a complete `server/index.ts` process launched through cco's generic command support. The selected folder, that workspace's data directory, normal Pi state, and valid Git worktree metadata are writable. Native cco's normal read access, network access, and state/temp exceptions remain. There is no `--safe`, Apply/Discard, project copy, or command-approval layer. [cco documentation](https://github.com/nikvdp/cco).

The installed cco examines cwd for a development checkout and loads `.env` before executing its sandbox helper. To avoid executing project-controlled launch configuration outside the sandbox, Margin invokes it from a fresh empty launch directory with a Git discovery ceiling, adds the selected project explicitly, and changes cwd inside the worker. Startup-sensitive environment fields, worker identity/token/data settings, and the absolute Node executable are pinned. Git metadata is resolved as data, requiring a recognizable metadata structure and cco's normal common-directory layout. Project `.env` is not automatically exported by this launcher; applications can load it inside the worker normally.

Every worker is pinned to one workspace ID. A worker API cannot create another workspace or run another workspace's conversation. Worker requests use an internal token. The browser connects once through a capability link printed in Terminal; only its hash persists. Fetching the gateway's public HTML does not grant permission to open more folders. Gateway cookies are not forwarded to workers. Proxied responses are limited to JSON/SSE with a restrictive API content policy.

## Storage and migration

The original `.margin-data/margin.sqlite` is the gateway's authoritative project/session-ownership registry and continues to hold Margin-source data. An external workspace's database and native session files live under `.margin-data/workspace-data/<ID>/`. Initial migration copies the appropriate sessions, transcripts, feedback, drafts, plugin records, batches, and native JSONL files through a staging directory. It preserves IDs and originals. Migration completion is recorded in the coordinator database, so removing worker-side metadata cannot trigger an overwrite from stale originals.

The gateway reads established worker databases in read-only mode and rejects replaced symlink paths. Root/source customization has permission to modify Margin itself and is consequently more trusted. Choosing a broad project such as a parent of Margin also deliberately grants that broader filesystem scope. Global Pi configuration remains shared under cco defaults; this is not strong isolation between hostile workspaces or a confidentiality boundary.

Checkpoints still exclude application data. Rolling code back to a version before this storage split will not expose newer external-worker data through that older interface; the data remains on disk and reappears when returning to the newer code. Saved code checkpoints are not data-format downgrade migrations.

## Starting and validation

From a normal Terminal, run `npm run build` then `npm start`, and click the printed connection link. Existing connected browsers can refresh after subsequent restarts. Worker startup failure is reported; there is no native fallback. Stop the gateway to stop its workers. A disconnected browser does not cancel agent work.

Tests use disposable app copies and an explicitly fake cco executable to exercise worker processes, routing, migration, browser authentication, cross-chat Notes, and streaming without model inference. That verifies application behavior, not OS enforcement. This development host cannot apply another Seatbelt sandbox (`sandbox_apply: Operation not permitted`), so actual cco must be exercised from the user's normal Terminal. `npm run test:sandbox` remains the native cco filesystem probe. The user previously confirmed the original cco launcher worked; this new worker launch still needs that normal-Terminal run.

The current target is native cco on macOS. cco's Docker fallback has a different filesystem/runtime environment and is not validated here; host Node paths and dependencies may require a Docker-specific runtime layout. [cco security model](https://github.com/nikvdp/cco/blob/master/SECURITY.md).
