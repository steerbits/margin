# Project notes

A local version 1 plugin with one manually edited notepad per project. It uses only the existing browser panel and server action/storage/publish APIs; no agent tools, message actions, or model calls are added. The host keeps plugin panels outside the conversation's scrolling area.

## Use

1. Open or create a conversation in the desired project, then click **Notes** in the toolbar.
2. Edit plain text (Markdown is preserved literally, not rendered).
3. Click **Save notes**, or press **Cmd/Ctrl+Enter** in the editor. Clearing the editor and saving clears the note.

The notepad is shared by every conversation in that project. Switching projects selects different storage. Notes are not automatically included in prompts.

**Refresh notes** reads storage without discarding a dirty draft. The panel also refreshes on opening, session changes, and window focus. It deliberately does not trust a different session's potentially stale published panel state. There is no continuous cross-tab synchronization.

If another session/tab saved first, the stale save is rejected. Your draft and the latest saved text are both shown. **Keep my draft** accepts the displayed revision as the new base, without saving; review/merge first, then explicitly Save. **Use saved note** asks for confirmation before discarding your draft. A further concurrent edit is checked again on the next save.

Unsaved drafts survive panel closure and session/project switches **within this browser tab**. The plugin requests the browser's leave/reload warning even when the dirty panel is closed. Drafts are not durable until Save; a confirmed reload, browser crash, or development hot replacement can lose them. Browser warnings are not guaranteed on every platform. Save errors retain the draft for retry.

## Storage and maintenance

- Data uses the host's SQLite store, normally `.margin-data/margin.sqlite` (or the configured `MARGIN_DATA_DIR`). It is not written into project files or browser localStorage.
- Namespace: `plugin:project-notes:<project ID>`, key: `note`.
- Record: `{ text: string, revision: number }`; missing records start empty at revision 0. Malformed stored records cause an error rather than silently resetting data.
- Text is preserved without trimming or categorizing, up to 100,000 JavaScript string characters (UTF-16 code units), validated on both sides.
- Revisions prevent stale overwrites within the app's single server process: the check and synchronous write contain no `await`. Running multiple independent servers against the same database is not supported by this concurrency scheme.
- Users maintain their own notes through the panel. Back up the app data directory using the app's normal database backup precautions. Keep this plugin ID/storage key stable; future record format changes need a migration.
- The current panel API requires an open conversation. On desktop, Notes remains beside the conversation with independent scrolling and an always-reachable close control. Opening/closing it preserves the bottom position or the first visible content block and its offset.
- At widths of 900px or less, Notes is a native modal overlay. Close it with the X, Escape, or a backdrop click; the underlying conversation stays in place and drafts remain intact. The browser prevents focus on background controls while it is open.

## Activate / reload

Server plugins load at startup; browser plugins are bundled. A browser refresh or **Reload skills** alone cannot install the server half.

After the current agent work finishes:

1. The production build has already been run for this change. For future edits, run `npm run build` first (not necessary for development mode).
2. **You** stop the current launcher with Ctrl+C, then rerun the same launch command, preserving its flags and environment (for example, `npm start` or `npm run dev`).
3. Refresh the browser with Cmd/Ctrl+R and open **Notes** in a conversation.

The implementation/test run does not restart the existing app or server.

**Visibility-fix update:** if `project-notes` is already activated, this follow-up changes only browser layout. After the build, save any unsaved drafts and refresh the browser; no server restart is needed.

## Verification

```sh
npm test
npm run build
npx playwright test --config tests/project-notes.playwright.config.ts
```

The dedicated browser configuration refuses to reuse port **4328**, builds a temporary copy with explicit test fixtures, and uses a disposable SQLite store. It neither restarts existing servers on 4317/4318 nor replaces the real app's build with fixture code. Its own test server and temporary copy are cleaned up at the end. No model inference is requested.

Observed checks for this implementation:

- **22 Node tests passed**, including 10 notes-specific checks: plugin discovery, exact Unicode/whitespace storage and clearing, reopening SQLite, cross-project/session isolation, stale revision rejection, input/corruption validation, storage failure, retained drafts, delayed-save edits, and conflict/retry behavior.
- **21 Chromium browser tests passed**, including all 10 existing workflows and 11 notes workflows. In addition to persistence, drafts, errors, and conflicts, the visibility regression checks opening Notes from the end of a long desktop conversation, scrolling the conversation without moving Notes, preserving a mid-conversation reading anchor, independently scrolling a short panel, and modal dismissal/background-focus protection without losing drafts.
- TypeScript checking and the production Vite build passed. The pre-existing large-bundle advisory remains (approximately 603 KB uncompressed).
- Desktop (1440×1000) and narrow (390×844) screenshots were inspected in self-review, and a short desktop window (1200×520) was exercised. The editor and controls were usable without page overflow. This was not an independent reviewer or evidence of the user's UI preference; Firefox/Safari, mobile virtual keyboards, and browser-crash recovery were not tested.
- The original visibility defect was reproduced before the fix: the new desktop test observed the editor's viewport intersection ratio as **0**. The same test passes after separating the panel from conversation scrolling. Visibility is asserted before any editor action or `scrollIntoView` could hide the defect.

The first browser attempt exposed a shared Vite HMR-port collision and a test that clicked before a project switch finished rendering. The isolated production-copy harness and a state-based assertion fixed those test issues; the existing host was left unchanged.
