# Customize Margin

Margin's source is now a special app workspace. The sidebar has a pinned **Customize Margin** entry, and the source project is displayed as **Margin** without moving its folder or changing its project ID. Existing source-workspace conversations and Notes data stay associated with that ID.

## Examples

Examples prepare a prompt in a new Margin-source conversation. They do not send the prompt or start model work automatically. Before a customization message is sent in the source workspace, Margin saves the current code as an automatic checkpoint. Identical saved states are reused, so interview turns that do not change code do not fill the history with duplicates.

The examples cover tasks, agent access to notes, decisions, supervisors, and richer result rendering. They are starting prompts, not built-in feature implementations.

## While another task is running

You can create conversations and save drafts while Margin is working. In its source workspace, **Send** is disabled while conflicting agent/background/plugin work is active. A visible explanation beneath the composer says why, on desktop and mobile; **View running conversation** opens the blocking chat when one is identifiable. Its existing Stop control remains available. Other workspaces can still send.

Availability is checked with the owning server approximately once a second. When work finishes or stops, Send becomes available again; drafts are **not queued or sent automatically**. Failed availability checks keep Send disabled with a retry action. The server enforces the same guard for stale pages and simultaneous requests. This is not worktree isolation: conversations still share source files and uncommitted changes.

## Plugins

The Plugins tab lists local plugin directories and their browser/server entrypoints. Optional `plugin.json` metadata supplies a short name and description. Existing plugins without that file remain supported.

On/off choices are stored in the source-controlled `margin.plugins.json` file. They apply to the whole app and become active after restarting the server and refreshing the browser. The tab distinguishes the requested setting from what is currently loaded. Returning a toggle to the already active setting removes the restart requirement.

Disabling preserves plugin source and project data. Disabled server modules are skipped before import, and the browser imports only the active modules requested by the server. A failed server plugin is reported while the core app remains available. Pi's separate `.pi` extensions and packages are not managed by this list.

## Named code checkpoints

History provides a flat list of named code states. It is intentionally not a general-purpose Git branch browser.

1. **Save checkpoint** records the current source files, including new non-ignored files and plugin settings.
2. **Preview changes** shows additions, modifications, deletions, and a code diff relative to the current files. Preview does not change working source files.
3. **Save current state & restore** preserves the current code before restoring the chosen checkpoint. If that exact state already has a checkpoint, it is reused.
4. **Return to before the last restore** previews that preserved state. The destination's name is shown. Restoring it uses the same mechanism, so you can move backward or forward without deleting history.

Every checkpoint remains available. Restoring does not move your Git branch, rewrite commits, reset the staging index, or run `git clean`. The snapshots live under dedicated `refs/margin/checkpoints/…` references, with labels and restore state in the private app data directory.

Source restores need a rebuild/restart before normal agent work resumes. If you return to the source state already loaded by the running server, another restart is unnecessary. Checkpoint and plugin changes are refused while known agent/background/plugin operations are active. Finish or stop those operations first; do not edit the source from another process during restoration.

### Scope and limits

- Checkpoints exclude `.margin-data`, the configured data directory, top-level `workspaces`, dependencies, generated build/test output, log files, and local `.env` files. Chats and saved notes are not rolled back.
- Code rollback does not reverse a plugin's database migration or edits to another project. Data-format changes need that plugin's own migration/recovery plan.
- Preview means a file diff. A separate running preview of an older app is not implemented; that would require an additional process and separate data handling.
- Stale previews are rejected if source changes before restore. Uncaptured/ignored-file collisions are rejected rather than overwritten. Symlink traversal is refused, and restores of symlinks/submodules are not supported by this version.
- Restores record their pre-restore checkpoint before changing files. Interrupted operations expose that state for recovery. Files and their expected contents are checked again before replacement; this is not a transactional filesystem protecting against arbitrary external programs editing simultaneously.
- Keep normal Git commits/backups as well. Checkpoint references are local and are not automatically pushed with your ordinary branch.

## Recovery if the interface breaks

The build installs a standalone, dependency-free recovery program under `.margin-data/recovery/recover.mjs` (or the configured data directory). It is outside source restoration scope, and an existing copy is preserved when later builds run.

After stopping the app, run it from Margin's source folder in a normal Terminal:

```sh
node .margin-data/recovery/recover.mjs list
node .margin-data/recovery/recover.mjs preview CHECKPOINT_ID
node .margin-data/recovery/recover.mjs restore CHECKPOINT_ID PREVIEW_TOKEN
```

Replace the identifiers with values from the list/preview output. The History tab also provides an absolute command for installations using another data directory. Restoring from this command still saves the current code and validates the preview token. Then reinstall dependencies if the lockfile changed, rebuild, and start with your usual cco launch command.

The recovery program itself does not need `node_modules`, the current UI, or the current server source. It still needs Node, Git, the repository's checkpoint references, and its private checkpoint journal.

## Ordinary workspaces

**New workspace** opens one macOS system folder dialog. It supports choosing existing folders and creating one through **New Folder**. The former HTML browser, separate name form, location bookmarks, and Margin shortcut are removed. **Customize Margin** remains the app-source entry.

The native helper uses AppKit `NSOpenPanel` with directory selection and directory creation enabled, files and multiple selection disabled. The local launcher receives its absolute path, validates it, and reuses or registers the workspace. Cancel leaves the current selection unchanged. Only one dialog can be open at a time; closing the requesting page or stopping the launcher cancels it.

This is a native macOS dialog launched by the local server. A browser `showDirectoryPicker()` handle does not provide the absolute filesystem path required by the Pi/cco process. Other platforms currently use pre-registered launch folders rather than the removed custom picker.

Each workspace still gets its own cco worker when used. Native folder selection does not copy the project, initialize Git, start an agent, or add a chat. Existing notes, project IDs, and session data are preserved. An old running server without the chooser endpoint shows the existing restart instructions.
