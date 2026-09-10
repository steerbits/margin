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
