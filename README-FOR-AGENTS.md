## How to customize Margin

Use the pinned **Customize Margin** area for example prompts, installed plugin controls, and named code checkpoints with preview, restore, and a return path. See [the customization workspace guide](docs/customization-workspace.md). The **New workspace** folder button opens the macOS system folder dialog.

[Checkpoint behavior and recommendations](docs/checkpoints.md) explains what happens before each source-workspace message, what is saved, how restore works, and the checkpoint hang fix and remaining improvements.

[Automatic update proposal](docs/automatic-updates.md) describes a cached release check in the header and updates through a prefilled customization chat, sharing checkpoint and recovery improvements with ordinary customization.

## Projects and the workspace picker

The workspace sidebar currently lists **local project folders**. A conversation runs with its selected folder as Pi's working directory. These entries are not containers or isolated worktrees.

- The application's source folder is displayed as **Margin**. Use **Customize Margin** or select **Margin** in the project dropdown to work on the app.
- Existing workspaces, including scratch projects, retain their saved conversations. Treat their folders as user files.

Click **New workspace** to open the macOS folder dialog. Select an existing folder or use the dialog's **New Folder** button, then choose **Open workspace**. There is no separate creation form or Margin shortcut in the chooser; **Customize Margin** opens the app source. Cancel keeps your current workspace. Folder creation and location selection happen in the native dialog.

New workspaces belong outside Margin's source folder, normally under `~/Projects`, and can have their own Git repositories. The chooser uses your last external location, `~/Projects` if it exists, or your home folder. `MARGIN_WORKSPACE_PARENT` can supply another external location. Existing nested workspaces remain accessible so their chats and paths keep working; they are excluded from Margin's Git tracking. Use **Customize Margin** for the app itself.

Unavailable registered folders are omitted from the picker and sidebar. Their saved chats and notes remain stored and return when their folders are available again.

The selected cco-default policy and launch commands are described in [cco integration](docs/sandboxing-proposal.md).

## Navigation and chat management

Selecting or creating a conversation updates the address to `/chats/<session UUID>`. Workspaces use `/workspaces/<workspace UUID>` and Customize uses `/customize/examples`, `/customize/plugins`, or `/customize/history`. Panels are encoded as `?panel=project-notes%3Anotes` (or `?panel=comments`). Refresh, bookmarks, and Back/Forward preserve the destination. Explicit URLs take precedence over the last selection in browser storage. These local links use the same browser connection as the rest of Margin.

**Rename workspace**, beside the New workspace icon, changes its saved display name; the folder path and UUID stay the same. The dropdown shows five recent workspaces and **All workspaces…** as its final item, after a separator. All workspaces searches by name or path. Recents are stored in this browser.

Right-click a conversation in the sidebar and choose **Delete conversation** to delete its messages, comments, composer draft, uploaded attachments, and native Pi transcript permanently after confirmation. The same menu is available with Shift+F10 when a chat row has keyboard focus. Stop running work and answer or cancel pending dialogs first. Deleting a chat keeps workspace files and shared plugin notes. Bookmarks to deleted chats show an unavailable destination.

Chat rows stay on one line without a chat icon or status text. A small spinner appears while the main agent is running, and a blue dot marks unread replies. The current chat’s header provides its detailed agent state. Summaries update approximately every 1.5 seconds across workspaces. Finished replies remain unread until the end of the latest reply is visible in the focused browser tab. Read markers persist in this browser across reloads; other browsers maintain their own read state. Restarted or exited workers report interrupted activity as stopped. Individual plugin background agents are not listed.

Recently opened chats render immediately from an in-memory cache while their live connection refreshes. The app prefetches saved history for the five newest chats in the current workspace without starting agents; a first uncached visit can briefly show a history placeholder. Switching preserves the reading position and keeps draft saves independent for each chat. Failed saves retain their text in the current browser tab and warn before leaving it.

## Run

The first installer targets native **macOS** with Node **22.19+** (Node 24 LTS recommended), npm, and Git. Clone this repository into its own folder, then run:

```sh
bash install.sh --start
```

The installer installs locked dependencies, builds Margin, verifies the real filesystem sandbox, and starts the app. Pi **0.85.1** and a pinned cco copy are included; no separate global Pi or cco installation is required. It leaves global Node/Git/Pi installations alone and refuses to replace existing dependency/build directories. Later starts use `bash start.sh`.

To create a fresh source copy first, use `bash install.sh --destination /path/to/new-margin --port 49422 --start`. The destination must not exist. This copies source and Git history; saved conversations, local environment files, credentials, and workspaces are omitted. A source repository that still tracks workspace files must have those files untracked first.

**Existing users:** update this repository in place. Keep `.margin-data/`, `.git/`, `workspaces/`, local configuration, and external projects. No chat or path migration is required. The launcher now uses private Pi configuration under `.margin-data/pi/` (or the configured data directory's `pi/` child). Your old global Pi login stays untouched; connect your provider once in Settings after restarting this version. See [preservation and updates](docs/installation.md).

Click the connection link printed in Terminal. The default address is **http://127.0.0.1:4317**. The launcher starts one sandboxed Pi server per active workspace. Run it from a normal Terminal; a restrictive parent sandbox cannot expand its inherited permissions. Development still uses `npm run dev`; restart after backend/plugin changes. The explicit legacy `start:native` command is not an installation fallback.

1. Open a project using the folder button, or select an existing project.
2. Open the gear beside **Connected** (or **Ready**). Expand **Provider accounts** to sign in or enter an API key, then choose a default model and thinking effort. Start a conversation. Until you choose a default, Margin prefers an available OpenAI Codex model.
3. **Shape with me** is selected for the first message of a new chat when available. Choose another skill or **No skill** if you prefer, then send your prompt.
4. Select text in a completed reply and choose **Comment**. Selections can cross formatting, table cells, or code. The button beneath a reply comments on the whole reply.
5. Save several draft comments, add an optional overall reply, and send them together. Sent comments remain anchored to the original reply when Pi produces a revision.

**Settings**, in the top-right header, saves new-conversation defaults across all workspaces and restarts. Choose a provider/model and a supported thinking effort, or leave **Automatic** / **Pi default** to retain the existing startup behavior. **Save** affects new chats only, including chats started from Customize Margin; **Cancel** and Escape discard edits. Settings are stored in Margin’s database, separately from the private Pi configuration. An unavailable selected model produces an error rather than silently switching providers. **Provider accounts** is expandable (opened automatically when no models are available). Account changes save immediately to Pi, independently of the conversation-default Save/Cancel controls. Default skill remains deferred.

The welcome screen’s **Default from Settings** uses the latest saved defaults. Selecting another model there overrides just the next chat; if it cannot support the default effort, Pi chooses its normal supported effort. The **Thinking** dropdown beside the model selects effort for the current conversation. It shows only supported levels, persists with the session, and is disabled while Pi is working. Neither conversation control changes your saved Margin or private Pi defaults.

Inline comments are sent as a normal user message: a short instruction followed by JSON with `inlineComments` (original `messageId`, `quotedPassage`, and `comment`) and `overallReply`. Visual highlighting and offsets stay in Margin; the model receives the quotations and feedback.

Tool rows show their outcome as text as well as color. Gray is normal running/success styling; red means Pi reported a tool error. For bash this may be a nonzero exit code (including a search returning no matches), a timeout, a stopped command, or a permission failure. Open the row for the actual output. Red is not a separate command-approval or danger classification.

## Reply buttons

Margin teaches the agent to offer complete next responses as `:reply[Use your defaults and go]`. Skills stay unchanged. Click the resulting send button to append its visible text to your message box on a new line and immediately send it with your saved comments and attachments. This sends the entire draft, including partial text; there is no insert-only mode yet.

Buttons are enabled only on the latest completed assistant reply, while the normal Send action is available. They wait for unfinished comments, uploads, pending dialogs, and active work. A failed send restores the combined draft; retry with either the same button or the normal Send button. Earlier replies remain readable but their buttons are disabled. Code, blockquotes, links, user messages, tool output, and artifacts do not gain reply actions. Malformed or unsupported syntax remains ordinary Markdown.

The format is declarative data, not Jinja or executable code. Labels are short, single-line plain text (up to 500 characters, no brackets, backslashes, or Markdown formatting). Margin's system-prompt guidance lives in `shared/reply-actions.ts`; the opt-in Markdown parser is `src/remark-reply-actions.ts`. New interaction types can be added later with both host behavior and matching prompt instructions. Restart Margin after building and refresh the browser to load the new instructions and renderer; existing prose is not retroactively converted into buttons.

## Chat attachments

In a Pi conversation, click the **paperclip**, drop files anywhere in the **chat pane** (not the sidebar), or paste an image into the message box. Files appear as compact, single-line removable chips, aligned with the message text; hover for the full filename and size. Choosing, dropping, or retrying files returns focus to the message box immediately so you can type while they upload; background completions never take focus away from another control or chat. Sent download chips use the same single-line treatment. You can send files with text, inline comments, a skill, or no text at all. Any file type is accepted, including Markdown and PDF. Limits are **20 MB per file**, **10 files / 50 MB per draft**, and **500 MB / 1,000 files per conversation**. Zip folders before uploading.

Completed uploads survive reloads and stay with their original conversation when switching chats. File selection and uploads remain available while the chat's live updates reconnect, including after returning from the OS file picker. Send still waits for the live connection and for uploads/removals to finish; failed uploads offer Retry/Remove, and failed sends retain their drafts. Incomplete uploads remain browser-local until acknowledged—finish them before closing the tab. Sent files appear as download links; arbitrary HTML/SVG is downloaded, never rendered in Margin's origin.

The agent receives a JSON manifest containing the message and each file's name, size, MIME hint, and absolute path, not base64 contents. Originals live in `attachments/<conversation ID>/` inside the owning worker's private data directory, accessible to Pi's tools, not in your project source. **Upload support is not universal format understanding:** Markdown can be read directly; PDF, Office, audio, and other binary formats depend on available tools. No OCR, conversion service, reader installation, or automatic execution is performed by the upload feature. The manifest asks the agent not to execute uploaded programs or install readers without permission; this is guidance, not a new security sandbox. Removing a draft deletes its original; deleting the conversation removes all its attachments.

After updating, build and restart Margin with your usual launch command, then refresh the browser.

## Installation instructions for a coding agent

When asked to install this project:

1. Read this README and `install.sh`. Use a standalone Git clone so Customize Margin retains repository history.
2. Confirm macOS, usable Node/npm, and Git. Use existing compatible tools. If a prerequisite is missing, explain the exact missing tool and help install it within the user's authorization.
3. For a fresh checkout, run `bash install.sh --start`, or use `--destination` with a new folder. Never overwrite an existing destination or delete a partial install to make a retry pass.
4. If your host blocks native sandbox execution, `--prepare-only` can finish dependencies/build. Report it as **prepared, sandbox not verified**, and give the user `bash /absolute/path/start.sh` to run in a normal Terminal. Do not use `start:native`, a fake cco, or disabled protections as a fallback.
5. Have the user complete sign-in in **Settings → Provider accounts**. Do not request tokens in chat, copy global credentials automatically, or silently switch billing providers.
6. Verify the connection link, first reply, a simple workspace file, and saved chat/notes after a restart. Report exactly which checks passed and what remains manual.

Existing installations are an update task. Preserve their data and Git history; do not use `git reset --hard`, `git clean`, or delete saved data, workspaces, uploads, or configuration to solve an installation problem. The installer refuses to replace existing dependencies/builds. Investigate the actual failure and use a fresh disposable checkout for validation.

This minimal release retains normal project/global skill discovery and inherited provider environment variables. Private saved Pi configuration does not isolate every host resource. Docker is deferred; use [Docker installation notes](docs/docker-installation-notes.md) when explicitly asked to adapt it.

## Preparing a GitHub repository

Keep the existing `.git` directory and publish the reviewed source branch; moving to a different folder is unnecessary. Saved data, workspaces, dependencies, generated builds, local environment files, and backup archives are excluded from Git. Check `git status` before committing, including any custom files outside these standard directories. Ignore rules do not remove files already tracked by Git. Workspace tracking should be empty (`git ls-files workspaces`); each project manages its own repository independently.

A normal source push does not back up local `refs/margin/checkpoints/` or private data. Keep those backups separately. Do not use a mirror push to publish personal checkpoint refs.

## Review generated artifacts

**Click a generated Markdown/HTML file or HTTP localhost app link in the agent's reply** to open it in a large browser-like review overlay. Ordinary output links work without manually registering a path/URL; the agent can also use `present_artifact`. The **Artifacts** toolbar button appears once the conversation has artifacts and reopens its reviews. Nothing opens automatically before you click.

Select text, choose **Point to comment**, or use **Comment on this page**. **Save** attaches a comment; **Edit** reopens it. Add optional **Overall feedback**, then **Send feedback** with the displayed attached-comment count. Page feedback retains its original URL, while overall feedback applies to the review. Saved comments from other artifacts in the same conversation stay attached when you switch pages or reopen the window. Once feedback is accepted, the review closes and returns you to the chat's latest activity. Failed/rejected sends stay open. Previously sent comments for the current artifact and page/link are kept under collapsed **Previous feedback**, pinned directly above the overall box and never resent automatically. When the artifact has sent feedback on other URLs, an **All previous feedback** link inside the expanded section lets you review it too. **Open in new window** shares the review; **Open original** omits annotation code.

Feedback stays in private Margin conversation storage, never in generated source files. Runtime-only injection leaves HTML and app code unchanged. Drafts survive closing/reloading, failed saves, and target changes; only explicit deletion removes annotations. Sending waits until the agent is ready. PDF/image viewers, arbitrary websites and self-improvement are deferred. See [artifact review](docs/artifact-review.md) for storage, proxy restrictions and verified workflows.

After updating the source, run `npm run build`, finish active agent work, restart Margin with your usual launch command, then refresh the browser. This is a shared core feature with modular viewers, not a separately installable v1 plugin.

## Skills and authentication

Margin uses Pi's own skill discovery, including `.margin-data/pi/skills/`, project `.pi/skills/`, and configured sources. The picker applies the selected skill to the **next message**; its instructions then remain in Pi's conversation. Reload skills with the refresh icon next to the picker. The bundled **Shape with me** skill lives in `skills/shape-with-me/SKILL.md` (skill identifier: `shape-with-me`). It is the default for a new chat’s first message; adding or choosing another skill does not change that default. If it is deleted or unavailable, new chats select **No skill**. Sending a message clears the picker, while the invoked instructions remain in the conversation. As before, your own Pi skills can be added without changing the app.

**Shape with me** combines clarification questions and automated evaluation with a compact default approach, concrete previews and alternatives, and an invitation to bring a real case that might reveal missing assumptions. It also summarizes what feedback actually changed in chat. The former **Think with me** skill has been removed.

Open **Settings → AI connections**, select a provider, and choose one of the login methods exposed by Pi. Browser authorization, device codes, authorization-code/redirect-URL fallback, and API-key/configuration prompts use one generic SDK adapter. This includes ChatGPT/Codex, Claude, xAI/Grok, GitHub Copilot, OpenRouter, Kimi Code, and Pi's API-key providers. Providers configured through the private Pi model configuration are discovered too; project-only provider extensions are not loaded by the gateway. Choose **Add custom connection** for a local model or company gateway, with optional discovery, manual model IDs, and a real test before saving. First-time setup opens this same Settings overlay. See [provider account setup](docs/provider-accounts.md) and [evaluation/screenshots](docs/ai-connections-review.md).

Built-in credentials stay in Pi's server-side authentication storage, normally `.margin-data/pi/auth.json`; custom connections and their keys use the private `models.json` beside it, and stay private to this installation. `npm run pi` → `/login` still works; refresh accounts/models afterwards. Reconnecting replaces that provider's saved login; **Remove saved login…** requires confirmation and also affects the bundled Pi CLI. External/environment credentials may still provide access after removal. Account changes do not change existing conversations' model selections, and Margin does not silently switch providers when a request fails.

`openai-codex` uses eligible ChatGPT/Codex subscriptions; `openai` is a separate API-key provider. Pi currently documents Claude Pro/Max third-party authentication as drawing from **separately billed extra usage**, not included plan limits. OpenRouter browser sign-in creates an API key billed from credits; a consumer Gemini subscription is not a Gemini API key. Live Claude/Grok inference and real vendor sign-ins have not been verified by this change. See [Pi provider documentation](https://pi.dev/docs/latest/providers).

An optional `MARGIN_AUTH_READ_ONLY=1` mode reads existing Pi credentials without acquiring its credential write lock. It is useful in restricted hosts, including the environment used to test this prototype. It **cannot refresh expired OAuth tokens**. Normal launches omit this variable and use Pi's normal refresh behavior. No credential copies are stored in the app database.

## What is supported

See [the compatibility matrix](docs/compatibility.md) for native UI, generic fallbacks, and deferred terminal features. Common dialogs have HTML controls. Tool calls show progress, output, errors, and edit diffs. Unknown tools retain readable results and structured details. Unsupported interactive terminal components produce an explicit compatibility card and can be stopped.

The interface does not impose a plan/execute mode: your selected skill and instructions determine when Pi proceeds. Adding a project loads its local Pi resources. Choose any existing writable folder in the picker; the launcher starts a cco worker for that workspace when it is used. Chats within a workspace share that worker. `--project /path` chooses the initial workspace and repeated `--add-dir /path` pre-register additional workspaces; these flags no longer grant every worker access to all listed projects. Margin runs only on loopback and assumes your local projects and installed extensions are trusted.

## Persistence and customization

App data is stored in `.margin-data/` by default. The original SQLite database keeps the workspace registry and Margin-source conversations/history; external workspace workers use `workspace-data/<workspace ID>/` for their SQLite data and native Pi JSONL files. Existing external-workspace chats, comments, drafts and notes are copied on first use, preserving IDs and originals. Notes is available before creating a chat and remains shared across all chats in its workspace. Set `MARGIN_DATA_DIR` to use another directory and `PORT` to choose a different local port. Browser disconnects leave agents and pending dialogs running on the server. After laptop sleep, the browser reattaches and catches up without a page reload. Eligible model-network failures receive bounded, cancelable recovery rounds after Pi's normal retries; Stop, uncertain tools, and pending questions remain protected. See [laptop sleep recovery](docs/sleep-recovery.md) for activation, limits, and verification. Slow live connections retain only the latest pending snapshot instead of accumulating unlimited history copies. After an unexpected runtime exit, eligible saved runs can receive one automatic continuation after exclusive worker ownership is verified. Explicit Stop, requested restarts, pending questions, and uncertain tool/background work remain manual; an in-progress tool promise cannot be restored. Private, bounded runtime diagnostics retain exit reasons. See [runtime recovery and verification](docs/runtime-recovery.md) for the safety policy, logs, and the required first clean restart after updating.

[Architecture and plugin documentation](docs/extensions.md) describe browser panels, message actions, tool/custom-message renderers, project storage, event subscriptions, background Pi sessions, and the backend boundary. Customize Margin provides examples, plugin controls, and checkpoints; a plugin marketplace and separately running version previews remain deferred. Plugin code is trusted local code and needs a reload/restart, or a rebuild in production.

To try customization through prompting, select **Margin's source folder** as the project, then use this prompt:

> Read `docs/extensions.md`, `server/plugin-api.ts`, and `src/plugin-api.ts`. Build a local `project-notes` plugin with a Notes side panel. Save notes separately for each project, and add a message action that can copy an assistant reply into a note. Use the existing version 1 plugin APIs. Verify persistence and run the build. Do not restart the running app; tell me when it is ready to reload.

Use `npm run dev` while iterating. For the production server, rebuild with `npm run build`, then stop/start the server once current agent work finishes. There is no automatic production plugin installer or hot activation yet.

Background-agent primitives exist in the plugin API, but the default main agent does **not** have a built-in subagent spawning tool. Installing a compatible Pi extension or adding a plugin that exposes that tool is still necessary for model-driven delegation.

For a new skill, add `.margin-data/pi/skills/my-skill/SKILL.md` for all workspaces in this installation, or `<project>/.pi/skills/my-skill/SKILL.md` for one project, then use **Reload skills**. Give the file `name` and `description` frontmatter followed by its instructions.

Margin runs Pi and server plugins inside each workspace's cco-wrapped Node process. The small local gateway handles browser authentication, Pi provider-account setup, folder selection, storage registration, and worker lifecycle; it does not execute agent sessions or server plugins. Native cco defaults allow reading the host filesystem and directly modifying the primary project, explicitly added folders, and normal state/temp paths; network behavior remains unchanged. There are no extra command approvals or Apply/Discard steps. A direct `start:native` launch only has inherited OS restrictions. Skill instructions to wait remain behavioral instructions, separate from cco's enforced boundary.

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