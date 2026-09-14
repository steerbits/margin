# Margin

A personal, local browser interface for Pi. Read Markdown, select a passage, collect comments in the margin, and send them with an overall reply. A chosen Pi skill drives the workflow.

Feature ideas and priorities are maintained in [BACKLOG.md](BACKLOG.md).

Use the pinned **Customize Margin** area for example prompts, installed plugin controls, and named code checkpoints with preview, restore, and a return path. See [the customization workspace guide](docs/customization-workspace.md). The **New workspace** folder button opens the macOS system folder dialog.

## Projects and the workspace picker

The workspace sidebar currently lists **local project folders**. A conversation runs with its selected folder as Pi's working directory. These entries are not containers or isolated worktrees.

- The source folder `inline-commenting-pi-codex-grill-frame-explore` is displayed as **Margin**. Use **Customize Margin** or select **Margin** in the project dropdown to work on the app.
- `tool-smoke` is a scratch folder created for the original live edit test. Existing conversations there are retained; do not delete the folder merely to clean up the picker.

Click **New workspace** to open the macOS folder dialog. Select an existing folder or use the dialog's **New Folder** button, then choose **Open workspace**. There is no separate creation form or Margin shortcut in the chooser; **Customize Margin** opens the app source. Cancel keeps your current workspace. Folder creation and location selection happen in the native dialog.

The chooser starts near your previous selection, or `~/Projects` if it exists, otherwise your home folder. `MARGIN_WORKSPACE_PARENT` can supply the initial location. This native chooser currently targets macOS; other platforms can pre-register folders with `npm start -- --project /path/to/project`.

Unavailable registered folders are omitted from the picker and sidebar. Their saved chats and notes remain stored and return when their folders are available again.

The selected cco-default policy and launch commands are described in [cco integration](docs/sandboxing-proposal.md).

## Navigation and chat management

Selecting or creating a conversation updates the address to `/chats/<session UUID>`. Workspaces use `/workspaces/<workspace UUID>` and Customize uses `/customize/examples`, `/customize/plugins`, or `/customize/history`. Panels are encoded as `?panel=project-notes%3Anotes` (or `?panel=comments`). Refresh, bookmarks, and Back/Forward preserve the destination. Explicit URLs take precedence over the last selection in browser storage. These local links use the same browser connection as the rest of Margin.

**Rename workspace**, beside the New workspace icon, changes its saved display name; the folder path and UUID stay the same. The dropdown shows five recent workspaces and **All workspaces…** as its final item, after a separator. All workspaces searches by name or path. Recents are stored in this browser.

Right-click a conversation in the sidebar and choose **Delete conversation** to delete its messages, comments, composer draft, and native Pi transcript permanently after confirmation. The same menu is available with Shift+F10 when a chat row has keyboard focus. Stop running work and answer or cancel pending dialogs first. Deleting a chat keeps workspace files and shared plugin notes. Bookmarks to deleted chats show an unavailable destination.

Chat rows stay on one line without a chat icon or status text. A small spinner appears while the main agent is running, and a blue dot marks unread replies. The current chat’s header provides its detailed agent state. Summaries update approximately every 1.5 seconds across workspaces. Finished replies remain unread until the end of the latest reply is visible in the focused browser tab. Read markers persist in this browser across reloads; other browsers maintain their own read state. Restarted or exited workers report interrupted activity as stopped. Individual plugin background agents are not listed.

Recently opened chats render immediately from an in-memory cache while their live connection refreshes. The app prefetches saved history for the five newest chats in the current workspace without starting agents; a first uncached visit can briefly show a history placeholder. Switching preserves the reading position and keeps draft saves independent for each chat. Failed saves retain their text in the current browser tab and warn before leaving it.

## Run

Requires Node 22.13+, cco, and a Pi login. This prototype pins `@earendil-works/pi-coding-agent` to **0.85.1**; it does not replace your global Pi installation.

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Click the connection link printed in Terminal. It opens **http://127.0.0.1:4317** and connects this browser; later refreshes and restarts retain the connection. `npm start` launches a local gateway and starts one cco-wrapped Pi server per active workspace. Run it from a normal Terminal; a process already inside a restrictive sandbox cannot expand its inherited permissions. For development, `npm run dev` provides Vite browser updates; restart after backend/plugin changes. Explicit legacy direct-launch commands remain `npm run start:native` and `npm run dev:native`; `npm run start:single-sandbox` retains the former single cco server launcher.

1. Open a project using the folder button, or select an existing project.
2. Start a conversation. The default prefers your OpenAI Codex subscription model.
3. **Think with me** is selected for the first message of a new chat when available. Choose another skill or **No skill** if you prefer, then send your prompt.
4. Select text in a completed reply and choose **Comment**. Selections can cross formatting, table cells, or code. The button beneath a reply comments on the whole reply.
5. Save several draft comments, add an optional overall reply, and send them together. Sent comments remain anchored to the original reply when Pi produces a revision.

The **Thinking** dropdown beside the model selects effort for this conversation. It shows only levels supported by the current model, persists with the session, and is disabled while Pi is working. It does not change your global Pi defaults.

Inline comments are sent as a normal user message: a short instruction followed by JSON with `inlineComments` (original `messageId`, `quotedPassage`, and `comment`) and `overallReply`. Visual highlighting and offsets stay in Margin; the model receives the quotations and feedback.

Tool rows show their outcome as text as well as color. Gray is normal running/success styling; red means Pi reported a tool error. For bash this may be a nonzero exit code (including a search returning no matches), a timeout, a stopped command, or a permission failure. Open the row for the actual output. Red is not a separate command-approval or danger classification.

## Review generated artifacts

Open **Artifacts** in a conversation to review a generated Markdown/HTML file or a running HTTP localhost app in a large browser-like overlay. Its read-only address bar shows the original location. Select text or choose **Point to comment**, collect saved drafts, and send feedback without returning to chat. **Open in new window** shares the same review; **Open original** omits annotation code. The agent can register outputs using `present_artifact` and include a review link in its reply.

Feedback stays in private Margin conversation storage, never in generated source files. Runtime-only injection leaves HTML and app code unchanged. Drafts survive closing/reloading, failed saves, and target changes; only explicit deletion removes annotations. Sending waits until the agent is ready. PDF/image viewers, arbitrary websites and self-improvement are deferred. See [artifact review](docs/artifact-review.md) for storage, proxy restrictions and verified workflows.

After updating the source, run `npm run build`, finish active agent work, restart Margin with your usual launch command, then refresh the browser. This is a shared core feature with modular viewers, not a separately installable v1 plugin.

## Skills and authentication

Margin uses Pi's own skill discovery, including `~/.pi/agent/skills/`, project `.pi/skills/`, and configured sources. The picker applies the selected skill to the **next message**; its instructions then remain in Pi's conversation. Reload skills with the refresh icon next to the picker. The bundled `think-with-me` skill lives in `skills/think-with-me/SKILL.md`. It is the default for a new chat’s first message; adding or choosing another skill does not change that default. If it is deleted or unavailable, new chats select **No skill**. Sending a message clears the picker, while the invoked instructions remain in the conversation. As before, your own Pi skills can be added without changing the app.

The optional **`shape-with-me`** sibling lives in `skills/shape-with-me/SKILL.md`. It retains clarification questions and automated evaluation, but replaces contract approval with a compact default approach, concrete previews and alternatives, and an invitation to bring a real case that might reveal missing assumptions. It also summarizes what feedback actually changed in chat. Use **Reload skills**, then select **`shape-with-me`** to experiment, preferably in a new chat so earlier skill instructions do not overlap. The default remains **Think with me**; no UI changes or influence score are included.

Sign in with `pi` → `/login`, then refresh models or restart Margin. Credentials stay in Pi's server-side authentication storage. `openai-codex` uses your ChatGPT/Codex subscription; `openai` is a separate API-key provider. The UI does not silently switch providers when a request fails.

Pi currently documents Claude Pro/Max third-party authentication as drawing from extra usage. Claude has not been live-tested in this build. See [Pi provider documentation](https://pi.dev/docs/latest/providers).

An optional `MARGIN_AUTH_READ_ONLY=1` mode reads existing Pi credentials without acquiring its credential write lock. It is useful in restricted hosts, including the environment used to test this prototype. It **cannot refresh expired OAuth tokens**. Normal launches omit this variable and use Pi's normal refresh behavior. No credential copies are stored in the app database.

## What is supported

See [the compatibility matrix](docs/compatibility.md) for native UI, generic fallbacks, and deferred terminal features. Common dialogs have HTML controls. Tool calls show progress, output, errors, and edit diffs. Unknown tools retain readable results and structured details. Unsupported interactive terminal components produce an explicit compatibility card and can be stopped.

The interface does not impose a plan/execute mode: your selected skill and instructions determine when Pi proceeds. Adding a project loads its local Pi resources. Choose any existing writable folder in the picker; the launcher starts a cco worker for that workspace when it is used. Chats within a workspace share that worker. `--project /path` chooses the initial workspace and repeated `--add-dir /path` pre-register additional workspaces; these flags no longer grant every worker access to all listed projects. Margin runs only on loopback and assumes your local projects and installed extensions are trusted.

## Persistence and customization

App data is stored in `.margin-data/` by default. The original SQLite database keeps the workspace registry and Margin-source conversations/history; external workspace workers use `workspace-data/<workspace ID>/` for their SQLite data and native Pi JSONL files. Existing external-workspace chats, comments, drafts and notes are copied on first use, preserving IDs and originals. Notes is available before creating a chat and remains shared across all chats in its workspace. Set `MARGIN_DATA_DIR` to use another directory and `PORT` to choose a different local port. Browser disconnects leave agents and pending dialogs running on the server. A server restart restores saved conversations and drafts, but cannot resume an in-progress tool or its waiting promise.

[Architecture and plugin documentation](docs/extensions.md) describe browser panels, message actions, tool/custom-message renderers, project storage, event subscriptions, background Pi sessions, and the backend boundary. Customize Margin provides examples, plugin controls, and checkpoints; a plugin marketplace and separately running version previews remain deferred. Plugin code is trusted local code and needs a reload/restart, or a rebuild in production.

To try customization through prompting, select **Margin's source folder** as the project, then use this prompt:

> Read `docs/extensions.md`, `server/plugin-api.ts`, and `src/plugin-api.ts`. Build a local `project-notes` plugin with a Notes side panel. Save notes separately for each project, and add a message action that can copy an assistant reply into a note. Use the existing version 1 plugin APIs. Verify persistence and run the build. Do not restart the running app; tell me when it is ready to reload.

Use `npm run dev` while iterating. For the production server, rebuild with `npm run build`, then stop/start the server once current agent work finishes. There is no automatic production plugin installer or hot activation yet.

Background-agent primitives exist in the plugin API, but the default main agent does **not** have a built-in subagent spawning tool. Installing a compatible Pi extension or adding a plugin that exposes that tool is still necessary for model-driven delegation.

For a new skill, add `~/.pi/agent/skills/my-skill/SKILL.md` for global use, or `<project>/.pi/skills/my-skill/SKILL.md` for one project, then use **Reload skills**. Give the file `name` and `description` frontmatter followed by its instructions.

Margin runs Pi and server plugins inside each workspace's cco-wrapped Node process. The small local gateway handles browser authentication, folder selection, storage registration, and worker lifecycle; it does not execute agent sessions or server plugins. Native cco defaults allow reading the host filesystem and directly modifying the primary project, explicitly added folders, and normal state/temp paths; network behavior remains unchanged. There are no extra command approvals or Apply/Discard steps. A direct `start:native` launch only has inherited OS restrictions. Skill instructions to wait remain behavioral instructions, separate from cco's enforced boundary.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:gateway
# From a normal Terminal, verify actual cco isolation:
npm run test:sandbox
```

Browser tests use explicitly enabled fixtures and do not request model inference. Their routes are absent in ordinary launches. `npm run probe` makes one live OpenAI subscription request and fails unless an actual reply arrives. Set `MARGIN_PROBE_MODEL` to choose the model.

Observed results and limitations are recorded in [evaluation notes](docs/evaluation.md).
