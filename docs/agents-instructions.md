# Instructions in Margin

## Where to edit

- **Customize Margin → Instructions** edits the embedded Pi installation’s global `AGENTS.md`, normally `.margin-data/pi/AGENTS.md`. It applies across workspaces in this Margin installation. Customize Margin’s existing wording and default Examples landing page are unchanged.
- Click the **workspace-name breadcrumb** to open that workspace’s home, then **Edit** or **Add instructions**. This edits `<workspace>/AGENTS.md`. For the Margin source workspace, this file guides work on Margin’s code; it is not the global file.

Each editor shows its scope and actual filesystem path. The workspace home links to global instructions without copying them into the local file. Notes and other workspace-scoped panels remain available before creating a chat. **New conversation** on the home opens the existing model-choice screen; chat links still open saved conversations directly.

Workspace homes use `/workspaces/<id>`; the model-choice screen uses `?view=new`. Global instructions have a direct `/customize/instructions` URL. Back/Forward and bookmarks retain the destination, and leaving a conversation preserves its draft and reading position.

## Saving and recovery

Instructions do **not** autosave. The Markdown textarea scrolls independently of the separate **Close / Save and close** controls. Save writes only the displayed file and collapses the editor, not the page. Missing files are created only after editing and explicitly saving. Saving an empty existing file keeps it as an empty file.

Closing or navigating away with edits asks in place: **Keep editing**, **Discard changes**, or **Save and close** (adapted to “and leave” when navigating). Browser-tab closure/reload uses the browser’s native warning. Drafts are not persisted across a confirmed browser exit.

Failed saves retain the draft and allow retry. A stale revision from another tab or an external editor is rejected. Copy anything needed from your draft before using **Reload saved file → Replace draft**; there is no automatic merge or force-overwrite. Discarding refreshes the preview from disk.

Model defaults and provider connections keep their separate Settings behavior; instruction controls never save or discard those changes.

### File safeguards

- Files are written atomically through a temporary sibling, with revision checks before committing. Browser saves to each target are serialized by its owning server. External programs do not participate in that transaction; avoid simultaneously editing the same file in another program.
- The editor supports valid UTF-8 up to **256 KiB**. Larger files, symbolic/hard links, non-files and read-only files are not replaced by the editor.
- If `AGENTS.override.md`, `CLAUDE.md`, or a supported uppercase variant is the effective context file, the editor explains the conflict and blocks changes that would silently alter precedence. Resolve these files outside Margin and reload. A multi-file instruction manager is not included.

## When instructions apply

Saved instructions are loaded before the next newly submitted message, including in existing Pi chats. A global save is picked up by each workspace worker; a local or ancestor-file save is picked up by sessions that inherit it. New sessions load the saved files normally. A run already underway, including its tool loop and retries, is not reloaded midway.

Margin refreshes **context only**, using Pi’s public resource-loader and prompt-rebuild APIs. It does not perform a full Pi reload, restart extensions, replace sessions, or change the selected tools, skills, model, settings, or history. The same refresh is used before prompts to Pi background agents created by Margin plugins. Third-party replacement backends own their own instruction handling.

Unreadable or invalid updated context blocks new input before acceptance and leaves the draft available for retry. Global and workspace context are inherited together; these are model instructions, not an enforced security policy or a guarantee of model compliance.

## Activation and verification

Finish active work, activate this source change with the [standard startup/build workflow](releases.md#discovery-and-running-identity), and refresh the browser. Production startup rebuilds changed versions automatically; same-version code edits require `npm run build` before restarting. No data migration is required. After this version is active, saving instructions does not require further restarts.

See the [evaluation record](evaluation.md#editable-global-and-workspace-instructions) for automated checks and limitations, and the [interaction spec](agents-instructions-spec.md) for the shaped behavior.
