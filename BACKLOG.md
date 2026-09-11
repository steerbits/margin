# Margin backlog

This is the persistent feature list for Margin. Add new ideas here as they come up. Priorities below are recommendations; items are not implemented unless marked complete.

| ID    | Feature                                                  | Status                                                      | Priority |
| ----- | -------------------------------------------------------- | ----------------------------------------------------------- | -------- |
| M-001 | Whole-server sandboxing with cco defaults                | Launcher implemented; local OS verification pending         | P0       |
| M-002 | Stable URLs for individual chats                         | Requested                                                   | P1       |
| M-003 | Clear project/workspace names and an app-source shortcut | Implemented: pinned Margin area and workspace creation      | P1       |
| M-004 | Prompt-driven plugin creation and activation             | Examples, plugin toggles, and named checkpoints implemented | P2       |
| M-005 | First-class subagents and supervisor panel               | Background-session primitives exist; orchestration pending  | P2       |
| M-006 | Project issue/task tracker                               | Idea                                                        | P2       |
| M-007 | Live validation of Claude and additional providers       | OpenAI verified; others pending                             | P2       |

## M-001 — Whole-server cco sandbox

Confirmed user decision: wrap the entire Margin server with cco defaults. Keep direct read/write access within the launched project and read access elsewhere under the native backend. Do not add isolated copies, Apply/Discard, extra approval gates, or stricter network/home-directory policies.

Implemented:

- `npm start` / `npm run start:sandbox` launch the Node server through `cco --command node`.
- The existing Pi SDK, streaming connection, plugins, tools, and child processes remain inside that server's process boundary.
- Pi state and Margin data have the write access needed for authentication and persistence.
- Implemented per-workspace cco workers: choose any writable project folder; the gateway launches that workspace with its own cco scope. Existing folders are preserved; opening and creating folders share the macOS native chooser.
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
- Implemented: display the app source as Margin and offer pinned Customize Margin with example prompts and source-workspace conversations.
- Implemented: New workspace opens the native macOS directory chooser, including New Folder. Customize Margin remains separate. Unavailable projects stay stored but are omitted from the current session.
- Show the full path and execution/sandbox mode.
- Label test folders clearly. Preserve existing conversations and files when hiding or renaming a test entry.

## M-004 — Generic customization through prompting

- Retain general panels, message actions/renderers, tools, project data, events, and runtime adapters.
- Implemented: installed-plugin list, on/off preferences with pending-restart status, and named code checkpoints with diff preview and reversible restoration.
- A separate running preview and automated server restart remain deferred.
- Keep server plugins and generated server code within the same cco envelope as the rest of the server.
- Avoid coupling the system to the supervisor and issue-tracker examples.
- Keep plugin source shareable independently of private project data; document host API/dependency compatibility when distributing a plugin.

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

## Code recovery

Named checkpoints preserve all saved states. Before restore, the current code is saved or an identical existing checkpoint is reused. The return control names its destination. Chats/notes are excluded, and an independent recovery command is installed outside the restored source. See [customization guide](docs/customization-workspace.md).

## Workspace Notes and worker execution

- Implemented: Notes works without a chat, stays open across chats, and shares the same workspace storage. Existing notes require no namespace migration.
- Implemented: arbitrary project folders with one cco worker per workspace; conversations retain the SDK/SSE interface.
- External workspace data is copied on first use, preserving originals and IDs. Docker fallback and actual native worker enforcement remain to be verified outside this development sandbox.

- Implemented: replaced the custom folder browser and creation form with a single native macOS folder dialog. Cancellation retains the current workspace; the native New Folder action controls creation and location.
