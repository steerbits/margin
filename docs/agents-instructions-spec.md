# Editable instructions: global and workspace

Approved interaction spec · implemented; see [usage and activation](agents-instructions.md) and the [evaluation record](evaluation.md#editable-global-and-workspace-instructions).

## 1. Two homes, clear scopes

| Scope | Interface home | File |
| --- | --- | --- |
| Global | **Customize Margin → Instructions** | `AGENTS.md` in the embedded Pi agent directory; normally `.margin-data/pi/AGENTS.md` |
| Workspace | **Workspace home → Instructions** | `<workspace folder>/AGENTS.md` |

Keep Customize Margin’s existing name, introduction, and “your app workspace” phrasing. Editing global instructions is customizing Margin. Add an Instructions tab without changing the existing default landing tab. Keep its editor separate from the Margin source card.

Use the configured paths, not hard-coded defaults. These are real files, not duplicate settings stored in Margin’s database. Global means this installation, not every Pi installation on the computer.

**Important example:** the Margin workspace’s root `AGENTS.md` guides work on Margin’s code. Customize Margin’s global `AGENTS.md` guides work across all workspaces. Show the scope and actual path above each editor.

## 2. Workspace home and navigation

The current workspace-name breadcrumb becomes a link to `/workspaces/<id>`, without the dropdown chevron. It no longer opens the system folder chooser.

Keep the existing folder action and Margin homepage entry for opening or creating a folder. Keep the workspace switcher. Selecting/opening a workspace lands on its home; selecting a conversation still opens that conversation directly.

Illustrative workspace home:

```text
Acme
/projects/acme                          [New conversation]

Instructions
Global instructions also apply.        [View global instructions]

Workspace instructions · AGENTS.md
Additional guidance for work in Acme.   [Edit]
```

Show a short read-only preview when the file exists; otherwise show “No workspace instructions yet” and **Add instructions**. The global section uses the same pattern with “Used across all workspaces in this Margin installation.”

Start with one Instructions section—no empty future tabs or plugin placeholders. Existing workspace-scoped panels, including Notes, remain accessible without creating a conversation. Preserve chat drafts, reading position, and running work when visiting the home. **New conversation** must still reach the existing model-choice/composer experience rather than loop back to the home.

**View global instructions** opens Customize Margin’s Instructions tab. Preserve a return destination to the invoking workspace or chat. Do not copy inherited global text into the workspace editor.

## 3. Shared editor behavior

**Edit** expands a plain Markdown textarea in the section. Focus moves into it. No autosave, automatic rewriting, or generated default instructions.

```text
Workspace instructions · Acme
/projects/acme/AGENTS.md
Saved changes are used starting with the next message.
Work already running is unaffected.

┌───────────────────────────────────────────────────┐
│ …editable Markdown…                               │
└───────────────────────────────────────────────────┘
Unsaved changes                 [Close] [Save and close]
```

- Keep the footer visible outside the scrolling textarea, including on small screens.
- **Save and close** writes only this file, then collapses the editor. It does not leave the page. Disable it when unchanged or while saving.
- **Close** with no edits collapses immediately. Return focus to Edit/Add instructions.
- Create a missing file only on a changed, explicit save. Clearing an existing file and saving leaves an empty file; deletion is not part of this version.
- These save controls never save, discard, or roll back the separate autosaving model/account settings.

### Unsaved changes

Attempting to close a dirty editor replaces its footer in place:

```text
Unsaved changes to Acme’s instructions.
[Keep editing] [Discard changes] [Save and close]
```

Leaving through a sidebar link, another Customize tab, the global-instructions link, or browser Back/Forward uses the same guard. Adapt the final actions to **Discard and leave** / **Save and leave**, then perform the originally requested navigation. Keep editing cancels it. Escape in the editor requests closing through this guard; it never silently discards.

Reloading or closing the browser tab requires the browser’s native unsaved-changes warning; an in-page confirmation cannot reliably intercept that exit. Persistent draft recovery is outside this version.

### Failure and concurrent edits

A failed save keeps the text and editor open with an inline error and Retry. Never navigate after a failed save. If another browser tab or an external editor changed the file since loading, reject the stale save rather than overwrite it. Keep the draft available to copy; offer **Reload saved file**, with confirmation before replacing the draft. No automatic merge or force-overwrite in this version.

## 4. Inheritance and next-message activation

Global instructions are inherited alongside workspace and ancestor-directory context. Do not describe workspace text as replacing the entire global file or as an enforced policy: these are model instructions, not a security boundary.

A successful save is picked up before the next newly submitted message in each affected conversation, including already-open chats. Global saves affect all workspace workers; workspace saves affect conversations whose context includes that file. Work already underway continues unchanged, including its tool loop and retries. New sessions load the saved files normally. No user-triggered restart or Reload skills action should be necessary.

If loading the updated instructions fails, block the affected new submission with a retryable error and retain its draft. Do not silently send with stale instructions. Saving to disk and activating a session are distinct operations; “Saved” must not imply an in-progress run was changed.

**Existing context files:** Pi can prefer `AGENTS.override.md` and also recognizes `CLAUDE.md` and uppercase variants. Before editing/creating AGENTS.md, detect the effective file. If another file is active, show its path and explain whether AGENTS.md would be ignored or replace its contribution. For this first version, block that conflicting edit rather than silently change instruction precedence. Keep other inherited files read-only; a multi-file instruction manager is deferred.

## 5. Checks and implementation boundary

### Source inspection completed

- [`src/App.tsx`](../src/App.tsx): the breadcrumb calls the folder chooser; workspace routes currently share the new-conversation surface. Home and new-conversation behavior need to be distinguished.
- [`shared/navigation.ts`](../shared/navigation.ts): workspace URLs already exist; the new Customize Instructions route must be added.
- [`scripts/installation.ts`](../scripts/installation.ts): workers inherit one installation-wide Pi directory.
- [`src/SettingsDialog.tsx`](../src/SettingsDialog.tsx): existing conversation defaults autosave, separately from this proposed editor.
- [`server/sessions.ts`](../server/sessions.ts) and the installed Pi SDK: context is cached. Pi’s full reload also reloads extensions and settings, not just instructions. Prefer a context-only refresh at a safe submission boundary; the exact supported integration requires implementation-time validation.

### Design self-review completed—not running UI tests

Self-review checked the agreed separate scopes and next-message behavior against mid-chat correction and a running second workspace. Additional cases identified safeguards for the new-conversation entry, concurrent file edits, alternate context filenames, and browser-tab closure. Automated document checks confirmed that all five local source links resolve and preview fences are balanced.

### Required implementation checks

- Navigation, bookmarks, Back/Forward, return paths, and workspace panels remain functional.
- Missing/empty files, exact text persistence, Unicode, failed writes, and concurrent-save conflicts behave as specified.
- Keyboard focus, mobile footer visibility, all dirty-exit paths, and unrelated settings autosave are covered in browser tests.
- Inspect actual assembled context in two workspace sessions: global update reaches both; a workspace update reaches only sessions inheriting it; old content is replaced, not duplicated; active runs are undisturbed.
- Test refresh failures and alternate context filenames; preserve tools, extensions, history, and composer drafts.

The original shaping work produced this spec only. Implementation was subsequently authorized and completed. Runtime context assembly, browser behavior, gateway routing, and build checks are recorded in [evaluation](evaluation.md#editable-global-and-workspace-instructions); live model compliance and real cco enforcement were not evaluated for this change.
