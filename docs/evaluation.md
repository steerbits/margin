# Evaluation record

Evaluated on September 10, 2026 with Pi SDK **0.85.1**, Node **25.5.0**, and Chromium through Playwright. The original `margin-prototype.html` remains unchanged.

## Live results

These checks made real requests through the existing `openai-codex` OAuth login. The execution host did not allow Pi's credential lock, so the checks used the documented read-only credential mode. Credentials were not copied into the project or browser.

| Check                          | Observed result                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subscription connection        | `gpt-5.6-sol` returned the requested confirmation text; Pi reported subscription authentication.                                                                                                                                                 |
| Skill discovery and invocation | The browser dropdown exposed the supplied `grill-frame-explore` skill. Selecting it produced consequential interview questions rather than implementation.                                                                                       |
| Live inline feedback           | Selected “Primary job:” in the actual reply, attached a comment prioritizing capture/retrieval and search by book title plus remembered phrase, and sent it with an overall reply. The comment became Sent and retained the original message ID. |
| Agent continuation             | Pi's next interview questions addressed a combined title/text search and phrase matching, alongside the other supplied decisions. It continued interviewing. No tools or files were modified in that interview project.                          |
| Real file/tool workflow        | In an isolated test project, Pi used `read` then `edit` to change `Hello from Margin.` to `Welcome from Margin.` The file matched the expected contents; both tool cards showed success and the edit card displayed the returned unified patch.  |
| Production boundary            | Production page ran without browser errors. Test fixture routes returned 404 and no fixture plugins were loaded.                                                                                                                                 |

An earlier attempt with `gpt-5.4` was rejected by the account despite appearing in Pi's catalog. That failure remained visible; the live probe was corrected to require a real non-error response before reporting success. It did not fall back to an API-key provider. The default now prefers the successfully tested `gpt-5.6-sol` among available OpenAI subscription models.

## Automated checks

**8 Node tests passed**, covering exact feedback serialization, duplicate/stale references, anchor ambiguity, dialog typing/cancellation/abort/timeout, explicit unsupported UI, database persistence/isolation, native transcript/tool mapping, interrupted follow-up recovery, and genuine SDK startup/extension-command dialogs. The last test uses a real Pi session and UI binding but makes no model inference request.

**9 browser tests passed**, covering:

1. Selection spanning bold text, table-cell selection, code selection, reload persistence, one feedback batch, and stable original anchors after a reply.
2. Draft editing/deletion and sent-comment resolve/reopen.
3. Browser reload while a dialog waits, correct typed return, and rejection of duplicate answers.
4. Unknown tool output, edit diffs, and explicit terminal-only interaction failure.
5. A narrow browser with inline comments and no page overflow.
6. Keeping an unfinished comment visible, opening the narrow comments panel, and jumping to the actual quoted passage.
7. Preserving a newer draft during delayed submission and preventing mutation of comments already being submitted.
8. Project plugin data persistence, custom-message rendering, invalid state rejection, a renderer throwing `null` with ordinary output still available, and creating/disposing a separate Pi background session.
9. A plugin registering a second, simulated main runtime and using the same browser selection/comment/send workflow through the backend interface.

TypeScript checking and the Vite production build passed. Vite reports a bundle-size advisory for the approximately 595 KB JavaScript bundle (about 183 KB compressed); bundle splitting is deferred for this local prototype.

The browser fixtures deliberately simulate responses so interaction tests are repeatable. The alternate runtime is a compatibility fixture, not an implemented Claude Code integration. The background-session test creates, subscribes, stops, and disposes the session without asking it to summarize; supervisor quality and scheduling are untested.

## Review and changes

Independent simulated SDK, architecture, and workflow reviewers inspected actual source and exercised isolated browser fixtures. These were synthetic specialist/user reviews, not evidence of the real user's preference.

Their findings led to changes including:

- exposing startup sessions before an extension waits for input;
- using Pi's settled event and deferring transcript refresh until Pi persists messages;
- recording submissions and native-session backups for interruption recovery;
- freezing comments during submission and preserving later composer edits;
- validating published plugin state and isolating renderer failures;
- adding a runtime-neutral backend registry and custom-message rendering boundary;
- keeping draft editors visible, making narrow-screen comments discoverable, and scrolling to the selected quote;
- displaying sent feedback as readable passages/comments instead of raw JSON.

Browser testing also caught a table-selection failure caused by remounting Markdown nodes when comment state changed. Memoizing the unchanged Markdown renderer keeps selections stable. The final tests exercise that regression directly.

## Remaining limits

- Claude and other real runtime adapters have not been authenticated or live-tested. Claude billing remains dependent on its current extra-usage rules and account configuration.
- Read-only authentication cannot refresh expired tokens. The app's normal credential-refresh path should be used outside this restricted execution host.
- Terminal component factories are not HTML components. Standard dialogs have native controls; unsupported custom interactions need adaptation.
- Server restarts cannot resume pending tool promises. Saved history/drafts are restored; interrupted submissions are surfaced for recovery rather than silently replayed.
- Long conversations, very large tool output, multiple simultaneous background agents, and all Pi extensions have not been exhaustively tested.
- Uploads, full session-tree navigation, a complete project-wide change audit, public distribution, and a production plugin manager remain deferred.
- Only Chromium was exercised automatically. Visual/readability and workflow preference still need the user's hands-on assessment.

Representative screenshots: [inline comment workflow](images/inline-comments.png), [live skill feedback](images/live-feedback.png), and [live read/edit tools](images/live-tools.png).

## Readability and effort update

Following hands-on feedback, the interface now uses white and neutral-gray surfaces, darker text, and 18px desktop conversation text with 31.5px line height (16px in narrow layouts). Secondary controls and the sidebar were enlarged too. A Chromium screenshot at 1919×1240 confirmed the computed text size and white background.

A new Thinking selector is backed by Pi's `getAvailableThinkingLevels()` and `setThinkingLevel()`. It changes only the current session, validates supported choices, and persists through Pi's native session history. The browser test checks setting an effort, reloading, and rejecting an unsupported value. Updated validation: 8 Node tests, 10 browser tests, and the production build passed.

## Whole-server cco launcher

The user's selected policy is cco defaults around the complete server, with direct edits to the launched project and explicit additional folders. The SDK and streaming architecture remain in place.

Four additional Node tests cover launch arguments and Pi state, literal paths with shell characters, execution metadata, and propagation of a fake cco failure without a native fallback. Updated checks: 12 Node tests, 10 browser tests, and the production build passed. `npm start -- --dry-run` also produced the expected whole-server launch command.

A real harmless cco invocation failed at Seatbelt setup with `sandbox_apply: Operation not permitted`; the user confirmed the development host is itself sandboxed. No further attempt to bypass that restriction was made. Actual OS boundary verification remains pending in a normal Terminal using `npm run test:sandbox`. Automated launcher tests are not evidence that Seatbelt was applied in this environment.

The user subsequently confirmed that launching the app through cco from their normal Terminal works. This is user-reported launch validation; results from the separate filesystem-enforcement probe have not been reported.

## September 11: comment focus, reply wrapping, and tool outcomes

User-reported regressions were reproduced in the isolated browser harness before changes: adding a comment near the end of a long conversation left the editor with viewport intersection ratio 0, and the short reply “ok” wrapped across multiple lines. The harness used disposable conversations rather than the user's running app or data.

The comment editor now waits until margin placement settles, restores the selected passage's position after reflow, and focuses without native auto-scrolling to the provisional location. It then ensures the editor/card is visible. The message width constraint now belongs to the outer user-message container, avoiding a nested percentage width that squeezed short text. Existing long-token wrapping is preserved.

Tool rows now show an explicit outcome in addition to their color: Done, Running, Exit N, Timed out, Stopped, or Failed, according to Pi's status and output. An exit code is not reclassified merely because it might be expected for a particular command.

All 22 Node tests and 24 Chromium browser tests passed, including the new late-conversation focus, short/long reply layout, and tool-outcome regressions plus all Notes visibility, storage, and draft workflows. TypeScript checking and the production build passed. The user's committed Notes plugin and reusable panel-layout changes were retained. Browser refresh loads these frontend fixes; the existing server was not restarted.

## Customize Margin and reversible checkpoints

Implemented a pinned app workspace with examples, installed plugin controls, a code-history view, and ordinary workspace creation. Source naming is a display change that preserves project IDs and folders. Examples prepare an unsent source-workspace prompt. Plugin settings distinguish desired and active state and skip disabled modules before import.

Validation: **33 Node tests and 29 browser tests passed**, with TypeScript checking and the production build. All actual restore operations in these tests used disposable Git repositories/app copies; no version was restored over the real project. The nine history tests cover source rollback and roll-forward, unchanged Git branch/index, private-data exclusions, stale preview rejection, ignored-file collisions, symlink ancestor rejection, tracked file/directory transitions, interrupted-state reconciliation, history locking, concurrent-change checks, and standalone recovery after source files have been restored away.

An independent simulated architecture review identified several of those failure cases before the fixes. Regression tests reproduced the issues and passed after correction. A separate simulated UX review exercised examples, naming, plugin settings, restore/return, and narrow layouts. Its findings led to visible workspace errors, proper preview-modal focus and Escape handling, a sidebar that closes when entering the narrow customization view, concise plugin descriptions, and a Return button that names its destination. Repeated on/off toggles no longer demand restart when settings match the active runtime.

The browser suite exercises diff preview without source mutation, restoring an older state, returning to the newer state, and preserving the existing Notes/comment workflows. It uses an isolated production-copy harness; the running user server and database were not restarted or rolled back. The initial saved checkpoint is code-only; it is not a backup of chats or plugin data. The independent recovery bundle lives outside source restoration scope. Runtime preview, data-migration reversal, and a general Git branch browser remain outside this implementation.

## Writable workspace chooser

Replaced path entry with a modal folder chooser and made new-workspace creation name-only, with its destination shown underneath. The server resolves symlinks, checks launch grants and filesystem access, and applies the same validation when opening projects or starting/resuming their sessions. Unavailable stored projects are omitted from bootstrap without deleting their data. New folders are created under the launch project's `workspaces/` directory.

Validation: **37 Node tests and 31 Chromium browser tests passed**, plus TypeScript checking and the production build. The four new Node tests cover grant boundaries, sibling-prefix/traversal and symlink escapes, hidden folders, extra locations, folder permissions, creation collisions, redirected parents, and native development access. Browser coverage includes folder navigation, modal focus/Escape, the name-only destination preview, and useful retryable errors against an older server. Three focused browser tests passed again after the final error-state adjustment, including a 390px-wide creation dialog with no horizontal overflow. Screenshots were inspected locally.

The stricter folder checks exposed a test fixture that picked an arbitrary registered project, sometimes a deleted Notes test folder. The fixture now explicitly selects the disposable app source. Tests used isolated data and made no model requests. No actual cco process was launched or restarted by this change; the OS sandbox policy is unchanged. The user confirmed that restarting their older server fixed the original Customize API error. Loading this later workspace update requires another server restart.

## Workspace Notes and separate cco workers

The user subsequently authorized arbitrary project locations with a separate cco boundary per workspace. `npm start` now starts the local gateway; it launches the existing Pi SDK server in a cco worker for each used workspace and proxies HTTP/SSE. New folders default to `~/Projects`, and existing folders are not moved. Notes already used project-keyed storage; its panel and actions now have an explicit workspace scope, work without an agent session, and remain visible across chat switches.

Validation: **42 Node tests, 32 existing Chromium browser tests, and 4 gateway browser tests passed**, plus TypeScript checking and the production build. The gateway harness uses an explicitly fake cco executable in a disposable application copy, exercising actual child server processes and streaming without applying an OS sandbox or making model requests. It covers connection authentication (including mixed-case route attempts), outside-source project folders, cross-chat Notes, separate workspace data, model-independent workspace actions, SSE updates, creation destinations, and failed worker startup without a native fallback. Node tests cover migration of existing data and native session files, preservation of originals, refusal to recopy newer worker data or follow replaced data symlinks, pinned launch fields, validated Git metadata grants, and hashed browser capabilities that survive restarts.

An independent simulated architecture review inspected the design and actual code. Its findings led to authoritative session ownership and migration state, staged migration, read-only worker-data queries, restricted proxy response types, pinned worker routes, worker lifecycle cleanup, case-sensitive API routing, and isolated workspace-list errors. Inspection of installed cco also identified cwd/.env processing before sandbox entry; workers therefore launch from a fresh neutral directory and enter the selected project after sandbox setup. Shared SQLite connections have bounded busy handling.

No actual cco process was launched from this restricted development host, and no user server was restarted. Normal-Terminal validation of this new worker launcher remains necessary. The earlier user-confirmed single-server cco launch does not establish that this new launch was tested with Seatbelt. Native cco's normal shared Pi state, broad reads, and network access remain; this is not a confidentiality boundary between hostile projects. The Docker fallback and downgrading the per-workspace data layout to pre-split application code are not validated. Originals remain available, and code rollback never deletes worker data.

## Native workspace dialog

Replaced the custom HTML folder browser and separate creation form with a single **New workspace** action. The authenticated local launcher invokes macOS AppKit's `NSOpenPanel`, with directories and New Folder enabled and files/multiple selection disabled. The selected absolute path is validated and registered using the existing workspace identity rules. Cancel preserves the current workspace/view; repeated selection reuses the project ID. The Margin chooser shortcut was removed; Customize Margin stays separate.

Validation: **46 Node tests, 32 existing browser tests, and 4 gateway browser tests passed**, plus the production build and TypeScript checking. An actual `osascript` invocation of the helper's noninteractive inspection mode returned `{"directories":true,"files":false,"newFolder":true,"multiple":false}`. Browser automation substitutes responses or the helper in disposable copies, so it exercises real registration, cancellation, deduplication, invalid-file rejection, busy state, and restart errors without opening system dialogs. Tests also cover literal path arguments (including Unicode, quotes and shell syntax), malformed results, concurrent chooser rejection, disconnect/shutdown cancellation, and explicit unsupported-platform errors.

The actual AppKit configuration was inspected, but a human selection/New Folder interaction was not automated. The chooser currently targets macOS; other platforms can still pre-register folders using launch arguments. No user server was restarted. The earlier custom-picker implementation remains in the saved “Before native workspace chooser” checkpoint; the live working source contains no custom picker component or creation form.

The user subsequently confirmed that the native workspace chooser works well in their normal app session. This is hands-on confirmation of the chooser, separate from the automated AppKit configuration check.

## UUID navigation and workspace/chat management — September 11, 2026

The app now navigates with stored chat/workspace UUIDs, preserves Customize tabs and panels in URLs, exposes documented plugin URL/navigation helpers, supports confirmed chat deletion and workspace display-name changes, limits the selector to five recent workspaces with searchable access to all, and shows main-agent activity/unread state. The bundled skill itself is now `think-with-me`, displayed as **Think with me**, and selected for each new chat's first message when discovered. Missing-skill fallback is **No skill**.

Observed validation:

- `npm test`: **53 tests passed**. Added coverage includes URL round trips, one completion ID per settled reply, stable IDs on reopening, errors received during running, Stop suppressing partial-reply notifications, deletion of owned native/app chat data while preserving workspace files and shared notes, actual renamed-skill discovery/default selection, and cancellation of late startup dialogs during disposal.
- `npm run test:e2e`: **40 browser tests passed** in a disposable app copy. New workflows cover selecting/creating chats, bookmarks/reload, Back/Forward, restoring the last chat from the root, draft-safe plugin navigation, rename persistence with an unchanged path, eight-workspace search/recents, deletion confirmation/Stop protection, deleted destinations, unread replies while viewing Customize or earlier content, focused visibility, mobile Notes overlays, and adding/deleting skills. Existing comment, Notes, customization, and recovery workflows also passed.
- `npm run test:gateway`: **five tests passed**, including external-workspace summaries, cross-workspace completion, renaming an active workspace, native production URL serving, deletion/owner removal, and preservation of shared Notes.
- `npm run build`: TypeScript, Vite production build, and independent recovery build passed. The existing Vite bundle-size advisory remains (approximately 628 KB JavaScript, 194 KB compressed).
- The skill-creator validator passed for `skills/think-with-me`. Its workflow instructions were retained; only the skill identifier and heading changed.
- Desktop (1440×1000) and mobile (600×800) screenshots were inspected. The new status and management controls remain legible, and the mobile chat keeps its status visible when the sidebar is closed. Test screenshots are written to `.margin-data/navigation-desktop.png` and `.margin-data/navigation-mobile.png`.

An independent simulated specialist review reproduced the cached-reply unread and lost-running-error defects, and identified stale worker names, deletion/startup races, initial storage clearing, unread occlusion, and navigation while management dialogs were open. Fixes were applied before the passing runs. This was a synthetic review, not evidence of real-user preference.

Limits: browser tests use fixture responses and made no new model inference requests. Headless Chromium reported both tabs as focused, so the focus-specific test explicitly simulates `document.hasFocus()`; the geometry, scroll, reload, and mobile overlay checks use ordinary browser interactions. Gateway tests use the existing cco shim to verify worker lifecycle and HTTP routing, not OS sandbox enforcement. Read markers and workspace recents are browser-local. Main-agent state is covered; individual plugin background-agent dashboards remain outside this change. Restart the running Margin process after building to activate the backend changes.

## Sidebar refinement and immediate chat switching — September 11, 2026

Following hands-on feedback, sidebar rows are single-line titles with no conversation icon or status text. They show only an inline running spinner or a blue unread dot. Deletion moved from the toolbar to the conversation context menu (right-click or Shift+F10), with confirmation and Stop protection retained. All workspaces is the final dropdown option after a separator, and Rename sits beside New workspace.

The switching delay came from discarding the current snapshot, awaiting the outgoing draft save, and reconnecting before showing the destination. Recently opened conversations now render from a bounded in-memory cache, preserving their scroll position. The five newest chats in the current workspace are prefetched through a saved-history endpoint that does not start agents or workspace workers. Draft saves run independently for each chat. Pending/failed drafts stay in their original chat, and atomic composer revisions prevent stale stream messages from replacing an acknowledged save. Uncached history may still require a brief read; runtime controls wait for live reconciliation.

Observed results for the final refinement:

- **57 unit tests passed**, including independent per-chat saves, serialization of newer edits, failure retention/retry, saved previews, bounded history caching, and rejection of older composer revisions.
- **44 browser tests passed**. New coverage verifies one-line rows/spinner/dot behavior, deleting a nonselected conversation without navigating away, keyboard context menus, switching while both the new stream and outgoing save are blocked, keyboard Send guards during reconciliation, failed-save retention, and delayed plugin/comment callbacks staying with their original chat.
- The latest switch measurement rendered the correct cached title and draft by the next animation frame in **14.7 ms**, with no loading placeholder and with network responses deliberately blocked. The assertion allows 200 ms to accommodate test-host variance. This measures the cached case, not a guarantee for first uncached visits or every machine. The recorded output is `.margin-data/chat-switch-timing.json`.
- **Six gateway browser tests passed**. The added test read saved history and its composer revision successfully while the disposable cco command was configured to fail; the workspace storage had not been initialized. This verifies that previewing saved history does not launch the worker.
- TypeScript and the production/recovery builds passed. Desktop screenshots were inspected; `.margin-data/sidebar-refinement.png` shows the revised sidebar. Existing mobile and commenting workflows passed.

An independent simulated review identified stale cross-chat callbacks, keyboard submission before reconciliation, stale draft snapshots, deleted-preview repopulation, and cached skill-choice issues. The fixes were exercised by the checks above. Gateway preview reads use one SQL query so composer text and revision cannot come from different SQLite snapshots. Browser fixture replies and simulated tab-focus signals retain the limitations described in the prior section; no new model inference was requested.
