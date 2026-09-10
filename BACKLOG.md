# Margin backlog

This is the persistent feature list for Margin. Add new ideas here as they come up. Priorities below are recommendations; items are not implemented unless marked complete.

| ID    | Feature                                                  | Status                                                     | Priority |
| ----- | -------------------------------------------------------- | ---------------------------------------------------------- | -------- |
| M-001 | Whole-server sandboxing with cco defaults                | Launcher implemented; local OS verification pending        | P0       |
| M-002 | Stable URLs for individual chats                         | Requested                                                  | P1       |
| M-003 | Clear project/workspace names and an app-source shortcut | Proposed from usability feedback                           | P1       |
| M-004 | Prompt-driven plugin creation and activation             | Extension primitives exist; product workflow pending       | P2       |
| M-005 | First-class subagents and supervisor panel               | Background-session primitives exist; orchestration pending | P2       |
| M-006 | Project issue/task tracker                               | Idea                                                       | P2       |
| M-007 | Live validation of Claude and additional providers       | OpenAI verified; others pending                            | P2       |

## M-001 — Whole-server cco sandbox

Confirmed user decision: wrap the entire Margin server with cco defaults. Keep direct read/write access within the launched project and read access elsewhere under the native backend. Do not add isolated copies, Apply/Discard, extra approval gates, or stricter network/home-directory policies.

Implemented:

- `npm start` / `npm run start:sandbox` launch the Node server through `cco --command node`.
- The existing Pi SDK, streaming connection, plugins, tools, and child processes remain inside that server's process boundary.
- Pi state and Margin data have the write access needed for authentication and persistence.
- `--project` and repeatable `--add-dir` configure writable folders at startup; opening a folder in the browser does not change cco's policy.
- The UI reports cco/native launch mode and identifies projects outside explicit writable paths.
- A failed cco launch exits without falling back to native execution.
- `npm run test:sandbox` checks outside reads, inside writes, blocked outside writes, symlinks, and child-process deletion using disposable files.

Validation: launcher planning/failure tests and the build pass. Actual Seatbelt launch is blocked by the development host's inherited sandbox (`sandbox_apply: Operation not permitted`); run the launcher and OS check from a normal Terminal. See [cco integration](docs/sandboxing-proposal.md).

## M-002 — Addressable chats

User request: each chat should have a URL, using a slug or UUID.

Recommendation: make the existing session UUID canonical, for example `/chat/<uuid>`, with an optional human-readable slug later.

Acceptance criteria:

- Opening a URL selects the correct project and conversation.
- Refresh, browser Back/Forward, bookmarks, and independent tabs work.
- Add a Copy link action; missing/deleted chats show a clear state.
- Production serves the application for deep links, rather than returning a file-server 404.
- Local URLs do not imply public sharing or bypass access controls.

## M-003 — Project/workspace clarity

- Explain that current entries are local folders, not sandboxes or disposable workspaces.
- Give the source project a friendly “Margin source” label and offer an Open app source action.
- Show the full path and, once implemented, the execution/sandbox mode.
- Label test folders clearly. Preserve existing conversations and files when hiding or renaming a test entry.

## M-004 — Generic customization through prompting

- Retain general panels, message actions/renderers, tools, project data, events, and runtime adapters.
- Make generated plugin discovery, validation, reload/restart, and rollback understandable from the UI.
- Keep server plugins and generated server code within the same cco envelope as the rest of the server.
- Avoid coupling the system to the supervisor and issue-tracker examples.

## M-005 — Subagents / supervisor

- Expose a model-callable spawning tool with explicit model, scope, and tool permissions.
- Display each child's activity, outputs, state, stop control, and model usage.
- Let a supervisor summarize observed activity in a side panel.
- Ensure child agents inherit the intended sandbox and cannot widen their permissions.

## M-006 — Project issue tracker

- Create/edit/complete tasks for later work, rather than immediately queueing agent messages.
- Convert a reply or comment into a task and preserve its source reference.
- Persist tasks per project and explicitly choose when the agent starts one.

## Completed foundation

- Local Pi SDK interface with Markdown, inline comments, batched feedback, and saved sessions.
- Skill picker and native dialog/tool/diff UI with documented fallbacks.
- OpenAI subscription, live skill/feedback, and file-edit verification.
- Runtime/plugin boundaries and compatibility fixtures.
- Readability update: larger text and neutral colors.
- Per-conversation thinking-effort selector.
