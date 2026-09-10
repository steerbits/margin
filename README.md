# Margin

A personal, local browser interface for Pi. Read Markdown, select a passage, collect comments in the margin, and send them with an overall reply. A chosen Pi skill drives the workflow.

Feature ideas and priorities are maintained in [BACKLOG.md](BACKLOG.md).

## Projects and the workspace picker

The workspace sidebar currently lists **local project folders**. A conversation runs with its selected folder as Pi's working directory. These entries are not containers or isolated worktrees.

- `inline-commenting-pi-codex-grill-frame-explore` is **Margin's source code**. Select it in the project dropdown, then start a new conversation to work on Margin.
- `tool-smoke` is a scratch folder created for the original live edit test. Existing conversations there are retained; do not delete the folder merely to clean up the picker.

If the source project is missing, click the folder-plus button beside **WORKSPACE**, paste the following path, and click **Open project**:

```text
/Users/paraschopra/Documents/Code/steerbits-prototypes/test-projects-to-test-prototypes/inline-commenting-pi-codex-grill-frame-explore
```

Then select it and create a conversation. This is the folder containing `package.json`, `src/`, `server/`, and `docs/extensions.md`.

The selected cco-default policy and launch commands are described in [cco integration](docs/sandboxing-proposal.md).

## Run

Requires Node 22.13+, cco, and a Pi login. This prototype pins `@earendil-works/pi-coding-agent` to **0.85.1**; it does not replace your global Pi installation.

```sh
npm ci --ignore-scripts
npm run build
npm start
```

Open **http://127.0.0.1:4317**. `npm start` now wraps the whole server with cco defaults. Run it from a normal Terminal; a process already inside a restrictive sandbox may be unable to apply Seatbelt. For development, `npm run dev` uses the same wrapper with automatic reloading. Explicit direct-launch commands are `npm run start:native` and `npm run dev:native`.

1. Open a project using the folder button, or select an existing project.
2. Start a conversation. The default prefers your OpenAI Codex subscription model.
3. Choose a skill, or leave **No skill** selected, then send your prompt.
4. Select text in a completed reply and choose **Comment**. Selections can cross formatting, table cells, or code. The button beneath a reply comments on the whole reply.
5. Save several draft comments, add an optional overall reply, and send them together. Sent comments remain anchored to the original reply when Pi produces a revision.

The **Thinking** dropdown beside the model selects effort for this conversation. It shows only levels supported by the current model, persists with the session, and is disabled while Pi is working. It does not change your global Pi defaults.

Inline comments are sent as a normal user message: a short instruction followed by JSON with `inlineComments` (original `messageId`, `quotedPassage`, and `comment`) and `overallReply`. Visual highlighting and offsets stay in Margin; the model receives the quotations and feedback.

## Skills and authentication

Margin uses Pi's own skill discovery, including `~/.pi/agent/skills/`, project `.pi/skills/`, and configured sources. The picker applies the selected skill to the **next message**; its instructions then remain in Pi's conversation. Reload skills with the refresh icon next to the picker. A copy of the supplied `grill-frame-explore` skill is included under `skills/` as a starter; your own Pi skills can be added without changing the app.

Sign in with `pi` → `/login`, then refresh models or restart Margin. Credentials stay in Pi's server-side authentication storage. `openai-codex` uses your ChatGPT/Codex subscription; `openai` is a separate API-key provider. The UI does not silently switch providers when a request fails.

Pi currently documents Claude Pro/Max third-party authentication as drawing from extra usage. Claude has not been live-tested in this build. See [Pi provider documentation](https://pi.dev/docs/latest/providers).

An optional `MARGIN_AUTH_READ_ONLY=1` mode reads existing Pi credentials without acquiring its credential write lock. It is useful in restricted hosts, including the environment used to test this prototype. It **cannot refresh expired OAuth tokens**. Normal launches omit this variable and use Pi's normal refresh behavior. No credential copies are stored in the app database.

## What is supported

See [the compatibility matrix](docs/compatibility.md) for native UI, generic fallbacks, and deferred terminal features. Common dialogs have HTML controls. Tool calls show progress, output, errors, and edit diffs. Unknown tools retain readable results and structured details. Unsupported interactive terminal components produce an explicit compatibility card and can be stopped.

The interface does not impose a plan/execute mode: your selected skill and instructions determine when Pi proceeds. Adding a project loads its local Pi resources. Under cco, write access is fixed at server launch: use `npm start -- --project /path/to/project` or repeatable `--add-dir /path` options. Opening a folder in the browser does not expand that scope. All sessions share the same server sandbox. Margin runs only on loopback and assumes your local projects and installed extensions are trusted.

## Persistence and customization

App data is stored in `.margin-data/` by default: SQLite for projects, comments, drafts, and plugin data; native Pi JSONL for conversations. Set `MARGIN_DATA_DIR` to use another directory and `PORT` to choose a different local port. Browser disconnects leave agents and pending dialogs running on the server. A server restart restores saved conversations and drafts, but cannot resume an in-progress tool or its waiting promise.

[Architecture and plugin documentation](docs/extensions.md) describe browser panels, message actions, tool/custom-message renderers, project storage, event subscriptions, background Pi sessions, and the backend boundary. Full customization features and a plugin marketplace are deferred. Plugin code is trusted local code and needs a reload/restart, or a rebuild in production.

To try customization through prompting, select **Margin's source folder** as the project, then use this prompt:

> Read `docs/extensions.md`, `server/plugin-api.ts`, and `src/plugin-api.ts`. Build a local `project-notes` plugin with a Notes side panel. Save notes separately for each project, and add a message action that can copy an assistant reply into a note. Use the existing version 1 plugin APIs. Verify persistence and run the build. Do not restart the running app; tell me when it is ready to reload.

Use `npm run dev` while iterating. For the production server, rebuild with `npm run build`, then stop/start the server once current agent work finishes. There is no automatic production plugin installer or hot activation yet.

Background-agent primitives exist in the plugin API, but the default main agent does **not** have a built-in subagent spawning tool. Installing a compatible Pi extension or adding a plugin that exposes that tool is still necessary for model-driven delegation.

For a new skill, add `~/.pi/agent/skills/my-skill/SKILL.md` for global use, or `<project>/.pi/skills/my-skill/SKILL.md` for one project, then use **Reload skills**. Give the file `name` and `description` frontmatter followed by its instructions.

Margin runs the Pi SDK inside its Node process, and `npm start` wraps that whole process with cco. Native cco defaults allow reading the host filesystem and directly modifying the primary project, explicitly added folders, and normal state/temp paths; network behavior remains unchanged. There are no extra command approvals or Apply/Discard steps. A direct `start:native` launch only has inherited OS restrictions. Skill instructions to wait remain behavioral instructions, separate from cco's enforced boundary.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# From a normal Terminal, verify actual cco isolation:
npm run test:sandbox
```

Browser tests use explicitly enabled fixtures and do not request model inference. Their routes are absent in ordinary launches. `npm run probe` makes one live OpenAI subscription request and fails unless an actual reply arrives. Set `MARGIN_PROBE_MODEL` to choose the model.

Observed results and limitations are recorded in [evaluation notes](docs/evaluation.md).
