# Evaluation record

## Follow-up: grouped provider-first model pickers

Replaced flat options in chat, new-conversation and Settings with **Saved Connections → Keys → Custom**, native group headers and `<hr>` separators. Added non-secret provider-name/auth-source metadata from Pi, shared provider-first labels, stable within-group sorting, empty-state Settings navigation and explicit unavailable-selection markers. All previously available environment/custom models remain accessible; ordering does not change automatic-default priority or existing chats. Memoized option rendering avoids re-sorting a large catalog on each composer keystroke.

- `npm run check`: **177 Node tests passed**, TypeScript and production build passed. The existing bundle advisory remains (about 688 KB / 212 KB gzip).
- **19 focused Chromium tests passed** (model pickers, Settings, provider accounts and composer UX), plus **2 focused gateway tests passed** (account guards and multi-workspace defaults). Complete browser/gateway suites were not rerun.
- New unit coverage checks group order, omission of empty groups, provider/model sorting, unchanged model identities/input ordering, routed labels, billing hints, and older/plugin metadata. An offline real-SDK fixture verifies unconfigured models are excluded; saved API keys override environment/custom keys; removing a saved connection restores the environment group; serialized models contain no fixture credential values or environment-key names. No user credentials were changed.
- Browser checks cover exact selected provider/model request payloads, group ordering/separator DOM structure in all selectors, moving a provider between groups during Settings refresh without resetting a selection, empty-state navigation, unavailable-current-model preservation, and 390px mobile bounds. Existing Settings/account tests cover default persistence and login-triggered model refresh.
- Self-review inspected actual Settings and mobile screenshots plus a deliberately expanded native-listbox preview of the group labels. The initial mobile screenshot had the sidebar covering the picker; the test now closes it before resizing. OS dropdown popups are outside Playwright page screenshots. Chromium hides `<hr>` in listbox mode, so rules are checked structurally, **not claimed as visually verified in the actual native popup**; group headings and keyboard navigation across group boundaries were exercised. Actual macOS/iOS/Safari menu separator rendering remains a manual check. No independent reviewer was available.

No live Margin process was restarted, real vendor authorization/inference performed, or real cco enforcement rerun. Restart Margin normally and refresh the browser to load the new server metadata and client. See [picker behavior](provider-accounts.md#model-pickers).

## Follow-up: generic Pi provider accounts in Settings

Added one SDK-driven account adapter rather than separate Codex/Claude/Grok backends. The authenticated gateway (and standalone native host) now supports Pi's browser authorization, device-code, selection, optional-text, secret and manual-redirect prompts. Provider methods are discovered from the installed runtime; the inspected 0.85.1 built-ins expose 40 providers, seven OAuth options and 39 API-key/token/configuration methods. Global custom model providers can add entries; the gateway does not load project extensions or agents.

- `npm run check`: **173 Node tests passed**; TypeScript and the production build passed. The existing bundle advisory remains (about 686 KB / 211 KB gzip).
- **6 focused Chromium tests passed** (provider accounts plus existing Settings regressions), and **2 focused gateway tests passed** (account access controls plus multi-workspace defaults). The complete browser/gateway suites were not rerun.
- Real SDK tests used disposable credential files: API-key login/removal, owner-only `0600` permissions, fresh-runtime Claude/Grok availability, and the actual xAI device-code implementation against mocked HTTP. Concurrent runtimes requesting an expired xAI credential caused exactly one mocked token refresh through Pi's credential locking. Extended the real LiveSession default/effort/dispose/reopen regression to Anthropic and xAI without inference.
- Negative cases covered secret-bearing provider errors, unsupported URL schemes, stale prompt replies, invalid options, blank secrets, shell/environment key expressions, concurrent operations, cancellation, expiry, read-only mutations, and committed-credential/local-sync failures. HTTP responses expose no credential values or raw provider errors. Browser tests checked password inputs, absence of submitted secrets from browser storage, persistent validation errors while polling, callback fallback/error/retry, shared-login removal confirmation, server-lost interaction recovery, automatic model refresh and independence from default Save/Cancel.
- Gateway checks exercised unauthenticated requests, hostile Origins, non-JSON mutations and read-only denial. Gateway tests use the existing process-routing shim, not actual cco OS enforcement.
- Self-review inspected actual desktop and 390px mobile screenshots. It led to expandable accounts (automatically opened with no models), denser buttons, scrolling new authorization instructions into view, and a retry path for lost server interactions. Browser automation initially found an exact-label lookup issue on the provider selector; explicit labels were added and the tests rerun. No independent reviewer or real-user preference evaluation was available.

No real provider login was changed, no live Claude/Grok inference was requested, and no live Margin process was restarted. Real vendor authorization, account eligibility/billing, remote-host callbacks and real cco behavior remain manual checks. Restart Margin normally (without `MARGIN_AUTH_READ_ONLY` for account changes), then refresh the browser to activate this build. See [account setup and limits](provider-accounts.md).

## Follow-up: shared new-conversation settings

Added the header gear and Settings dialog for a default model and supported thinking effort. Defaults live in Margin's SQLite preferences; the gateway owns the app-wide record and passes a snapshot to each workspace worker only at chat creation. Existing chats keep their choices. Default skill remains deferred.

- **114 Node tests passed**, **57 Chromium browser tests passed**, and **8 gateway browser tests passed**. TypeScript and the production build passed; the existing bundle-size advisory remains (about 668 KB / 206 KB gzip). Focused settings/adapter tests were rerun after the final typed restoration fix.
- Covered settings persistence across database reopen, exact provider/backend identity, unsupported effort rejection, unchanged storage after rejected saves, per-chat model overrides, fresh defaults across workspace workers, gateway authentication, and ignoring browser-injected worker defaults.
- Browser workflows checked Save, reload, Cancel/Escape with focus return, failed-save draft retention, unavailable-model recovery, capability changes, unchanged existing chats, and new-chat inheritance. Inspected actual 1440px desktop and 390px mobile screenshots as self-review; no independent reviewers or real-user preference evaluation were available.
- A real SDK adapter regression test uses disposable configuration and an unused test API key without inference. It verifies new defaults, manual per-chat effort, adapter disposal/reopen, and byte-for-byte preservation of global Pi settings. It caught and fixed an empty-chat edge case: Pi does not automatically restore thinking entries until a transcript has messages, so Margin now explicitly restores those saved entries too.

Live model inference and actual cco OS enforcement were not rerun. Gateway tests use the existing process-routing shim. No active Margin process was restarted; restart Margin and refresh the browser to activate the new backend routes and built UI.

## Follow-up: optional all-URL history for the current artifact

The human identified a discoverability gap when a URL changes and requested **All previous feedback** only when it adds more comments than page history. Added that link inside expanded history, scoped to sent, non-deleted comments for the current artifact, with **This page only** to return. The section remains reachable at zero page comments if artifact history exists elsewhere. Navigation/collapse resets to page history; neither switching scope nor viewing sent notes changes the URL, attachments or storage.

- **72 Node tests passed**, TypeScript and production build passed; **10 focused artifact Chromium tests passed**. Extended the existing history tests rather than adding a separate workflow count.
- Verified absence of the link for single-page Markdown even with other artifacts' history; additional app URLs enabling it; all mode excluding another artifact and unsent drafts; unchanged preview address/attachment count; zero-page history access; returning to page-only mode; reset on navigation/collapse; and preserved footer placement. Inspected the actual all-history screenshot as self-review.
- Full browser/gateway suites and live-model editing evaluation were not rerun for this focused frontend change. The existing bundle-size advisory remains (about 662 KB / 204 KB gzip). A browser reload loads the update; no server restart or feedback-data migration is required.

## Follow-up: bottom-pinned, page-specific previous feedback

The human noted that history floated midway down the sidebar and followed neither the selected artifact nor its page. Moved **Previous feedback** outside the active-comment scroller, directly above the overall box. Its expanded height is bounded and scrollable. History now matches the current registered artifact plus displayed path/query/hash, using the existing saved target route; no new scope control or storage migration was needed. Unsent attachments remain conversation-wide and visible. Content revisions do not hide prior feedback for the same page.

- `npm run check`: **72 Node tests passed**, TypeScript and production build passed. Added scope checks for another artifact, path, query, hash, draft/submitting/deleted annotations, old revisions and encoded file entry routes. The existing bundle advisory remains (about 662 KB / 204 KB gzip).
- `npm run test:e2e -- artifacts.spec.ts`: **10 artifact Chromium tests passed**. The new workflow sends two home-page comments, one query/hash-specific app-page comment and a Markdown comment; reopens and switches pages; verifies only matching history appears; retains a new Markdown attachment while reviewing the app; and measures the history/footer adjacency while the active list scrolls, with history expanded/collapsed and at a narrow viewport.
- `npm run test:gateway -- artifacts.spec.ts`: **1 passed**. The full browser and gateway suites were not rerun for this focused frontend follow-up.
- Inspected the actual screenshot showing two collapsed prior comments immediately above the overall box while five pending comments occupy the independently scrolling list. This was automated-fixture testing and self-review, not independent review or a claim about live model quality.

Only frontend behavior changed; a browser reload loads the built update, without restarting the server. Feedback storage and generated artifacts were not changed. Route changes follow the preview bridge's existing URL reporting; app state that does not change the URL is not treated as a distinct page.

## Follow-up: accepted feedback returns to the processing chat

The human adopted the proposed lifecycle defaults and emphasized seeing the chat as processing begins. Implemented: hide the empty Artifacts launcher; retain sent comments under initially collapsed **Previous feedback**, with unsent comments still visible; close the overlay and scroll to latest chat activity on batch acceptance. Standalone reviews navigate to their associated chat rather than leaving the user in a review page or an unrelated browser tab. Overall-only chat messages now say **Overall feedback sent** rather than “0 artifact comments sent.”

- `npm run check`: **71 Node tests passed**, TypeScript and production build passed. Added assertions for conversation-scoped batch status through prepared, submitting, rejected and accepted states. The bundle-size advisory remains (about 661 KB / 204 KB gzip).
- `npm run test:e2e`: **54 Chromium tests passed**, including **9 artifact workflows**. Verified returning from a long/scrolled conversation to visible sent feedback while the backend is still busy; old comments collapsed after an actual file update; new unsent comments remaining visible and attached; hidden launcher before registration and its appearance without a reload; combined and overall-only sends; separate-window return to the correct chat; HTTP failure and delayed preflight rejection preserving feedback; and closing only after acceptance, not merely an HTTP `submitting` response.
- `npm run test:gateway -- artifacts.spec.ts`: **1 passed**, including standalone review returning to the correct external-workspace conversation. The full gateway suite was not rerun; its prior unrelated unread failure remains documented below.
- Inspected the actual updated-report screenshot with one active draft and collapsed previous feedback. Evaluation used self-review and simulated-agent browser fixtures, not independent reviewers or a live model editing-quality evaluation.

The implementation adds explicit submission confirmation to the review state endpoint. Loading this version requires restarting Margin and reloading the browser; an older server produces a check-chat/restart notice rather than an indefinite Sending state. No live server was restarted. Private feedback storage and generated files were left unchanged. The previously reported persistent history-lock incident remains unconfirmed and was not bypassed by this work.

## Follow-up: backdrop dismissal, save shortcut and history-lock investigation

Implemented the two explicit interaction requests: outside-click dismissal (without dismissing on a drag out of the editor) and ⌘Enter/Ctrl+Enter to save the focused comment without sending it. Plain Enter remains multiline. Existing recovery is retained on dismissal, including an offline comment and overall feedback. Collapsing sent comments, closing after accepted Send, and hiding the empty Artifacts launcher remain recommendations pending the human's decision—not implemented behavior.

- TypeScript passed; **71 Node tests passed** and **8 focused artifact Chromium tests passed**. The browser fixture build passed. Full browser/gateway regressions were not rerun for this follow-up.
- Added checkpoint tests: a capture failure releases its lock; a potentially live owner remains protected; a confirmed-dead owner's lock is recovered on retry without a server restart. These do not reproduce the reported persistent block.
- Traced the reported error to the shared pre-send source-workspace code-history guard, not comment storage. No `operation.lock` remained in the live data tree to identify its original owner. The exact incident is unresolved; no live lock was deleted and no server was restarted.
- Confirmed `.margin-data/` and the example `workspaces/` files are Git-ignored, with no tracked entries. Artifact registration stores references in private conversation SQLite records; files remain in their original locations and recovery drafts remain browser data.

## Follow-up: artifact review workflow simplification

Human feedback changed the entry point from manual file/URL registration to clicking an ordinary agent output link; retained **Comment on this page** while adding separate **Overall feedback**; replaced Retarget/implicit attachment with **Save / Edit / Delete**; and made saved attachments conversation-wide. The original disabled-Send incident was not captured directly, but inspection found artifact-local batch filtering and unlabelled blocked states. These now have explicit regression coverage.

- `npm run check`: **70 Node tests passed**, TypeScript and production build passed. Added ordinary-link classification, explicit Save gating, overall-only delivery, preservation of newer overall text, and offline/conflicting overall-draft tests. The bundle-size advisory remains (about 659 KB / 203 KB gzip).
- `npm run test:e2e`: **52 Chromium tests passed**, including **7 artifact workflows**. Newly exercised ordinary Markdown/HTML/localhost assistant links with no prior artifact registration and no auto-open; Save/Edit; **two saved comments → switch artifact → close → reload → reopen → send**; retention of a page comment's `/details` URL; combined and overall-only feedback; and a pending agent question with a visible explanation and restored Send after answering.
- `npm run test:gateway -- artifacts.spec.ts`: **1 passed** through the external-workspace gateway. The complete gateway suite was not rerun for this follow-up; its previously reproduced unrelated unread failure is recorded below.
- Inspected the actual revised UI screenshot with two attached source-labelled comments and overall feedback. Also rendered/navigated the generated two-page HTML example in Chromium. Reviews were self-review and automated fixtures, not independent reviewers or evidence of real-user preference.

The live Margin process and old port-4330 demo were not restarted or replaced. Existing demo data was left intact. After a Margin restart, the generated `workspaces/artifact-review-example/index.html` can be reviewed in the actual conversation; unlike the old demo, feedback is not answered by a simulated agent. Other compatibility and evaluation limits below still apply.

## September 14: initial generated artifact review

Implemented the shared review overlay and standalone window, a read-only original address, Markdown/HTML/local-app viewers, runtime-only injection, durable conversation-associated drafts and normal chat batch delivery. Source HTML was compared byte-for-byte before and after review. No annotation code is written to generated artifacts.

Observed checks:

- `npm run check`: **67 Node tests passed**, TypeScript and production build passed. This includes 8 new artifact/storage/proxy/recovery tests. Vite still reports the existing large-chunk advisory (main JS about 653 KB, about 201 KB gzip).
- `npm run test:e2e`: **49 Chromium tests passed**, including 4 new artifact workflows: Markdown selection and exact chat delivery; real Vite module/HMR and modal/button interaction; original HTML and a separate review window; failed network saves and explicit deletion.
- `npm run test:gateway -- artifacts.spec.ts`: the new external-workspace artifact review/delivery test **passed**, including the isolated iframe opened through the gateway. This uses the existing cco test shim, not actual OS sandbox enforcement.
- The six pre-existing gateway tests produced **5 passes and 1 failure**: `workspace-worker summaries, renames, deep links and deletion preserve stable identities` fails at its unread-indicator assertion. The same assertion failed again in an isolated checkout of the pre-artifact commit. It was not fixed or hidden in this feature's scope.
- Actual desktop screenshots were inspected for the Markdown viewer and live-app modal/comment flow. No independent reviewer was available: architecture, preservation and interaction checks were self-review plus automated tests, not independent/user preference evidence.

Browser fixtures simulate agent replies; live model editing quality was not retested. Only Chromium was exercised. Arbitrary frameworks, authenticated apps, canvas targeting, large-scale performance, real cco enforcement for the new listeners, and new PDF/image viewers remain unverified/deferred. The interactive demonstration is a separate disposable test app with temporary data and simulated replies, not the user's real chat. See [artifact review](artifact-review.md) for exact supported behavior and limits.


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
