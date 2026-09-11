# Architecture and extensions

```
React interface ─── normalized messages, comments, dialogs, snapshots
        │
Local HTTP + SSE gateway → cco workspace host → AgentBackend contract
        │                         │
SQLite app storage          Pi backend (0.85.1 SDK)
                                  │
                          Pi resources and native sessions
```

`shared/types.ts` is the browser/server data contract. `server/backend-api.ts` defines the runtime boundary consumed by HTTP handlers. Pi-specific behavior lives in `server/sessions.ts`, with normalization in `server/transcript.ts` and the HTML UI bridge in `server/ui-bridge.ts`. The browser never receives the Pi session object or credentials.

This separation is designed to let an additional runtime implement the backend contract without replacing the commenting UI. Only Pi is currently implemented and live-tested. A different runtime still requires an adapter, authentication work, and meaningful compatibility tests.

## Local plugins

Add a directory under `plugins/` with either or both:

- `server.ts`: default export implementing `ServerPlugin` from `server/plugin-api.ts`.
- `client.tsx`: default export implementing `BrowserPlugin` from `src/plugin-api.ts`.

Both use a unique lowercase `id` and `apiVersion: 1`. Server plugins load at startup; browser plugins are bundled by Vite. Restart during development, or rebuild and restart production, after adding a plugin. Server plugin code executes inside the workspace worker's cco boundary and is intended for your own trusted code.

**Customize Margin → Plugins** now controls enabled directories through `margin.plugins.json`. The browser bundle contains discoverable modules but loads only the active folders named by the server; disabled server modules are skipped before import. Changes take effect after server restart/browser refresh, and the UI reports pending changes. Add optional `plugin.json` with `name` and `description` for a concise installed-plugin listing.

## Where plugins and their data live

The installed Notes plugin is source code under `plugins/project-notes/`, including its server/client entrypoints and local helper/style files. It is tracked in Git. Sharing this repository at a commit containing that directory includes the plugin; the recipient's build/start discovers it and respects `margin.plugins.json`. There is no external package installer yet.

Saved notes live in their workspace worker's SQLite database, under `plugin:project-notes:<project ID>`. External workspaces use `.margin-data/workspace-data/<ID>/margin.sqlite`; Margin-source data retains the original database. The data directory is ignored by Git: cloning the code does not copy your notes, chats, or credentials. Someone with their own existing Margin checkout can copy the plugin directory into `plugins/`, then rebuild/restart, provided the host API and any dependencies are compatible. Sharing the entire folder manually can include local data unless you deliberately exclude it.

## What to try asking for

These are examples of new plugins, not features already installed:

- “Add a project task tracker and a Turn into task action beneath replies.” Panels, message actions, server actions, and project storage cover this.
- “Give Pi tools to read and update my project notes.” The current Notes plugin is a manual notepad; adding SDK tool definitions would make those operations available to the model.
- “Show a supervisor's summary of the main agent in a panel.” Event subscriptions and separate Pi sessions provide the mechanics; invocation cadence, model usage, and stop controls still need implementation.
- “Keep a decision log and bookmarked quotations for each project.” Use message actions and persistent project storage.
- “Show charts or a richer preview for a tool's structured output.” Use tool/custom-message renderers, with the normal result fallback retained.
- “Add workflow buttons that prepare a review prompt in the composer.” Use panel controls or message actions with `setComposer`.
- “Connect a different agent runtime to this UI.” Server plugins can register backend adapters, but each real integration needs its own authentication and compatibility work.

The browser plugin surface offers panels, actions, and result renderers. Server plugins offer actions, Pi tools, events, project storage, and child sessions. Pi extensions separately provide agent-level hooks, such as adding context before a turn. For example, automatically inserting notes into every model request needs an appropriate Pi extension or a new host hook; the current `getMessages()` callback only reads history.

Features that replace the main composer, overhaul navigation, or change transport need core host changes or new extension points. The recent Notes visibility fix is a concrete example: the notepad is a plugin, while keeping all plugin panels outside the conversation scroller required a reusable host-layout change.

## Available extension points

| Idea                                       | APIs involved                                          | Boundary                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Project notes, decisions, or issue tracker | Workspace panel + `workspaceAction`, project `storage`, optional Pi `tools` | A `scope: "workspace"` panel receives `project`, optional `sessionId`, and `action`; it works without a chat and stays open across chats. Storage is shared by workspace. |
| Activity monitor                           | `onEvent`, `getMessages`, `publish`, panel             | Uses public agent/tool activity; does not inspect hidden model internals.                                                                 |
| Supervisor/summarizer                      | `createAgent`, `subscribe`, `prompt`, panel            | Independent Pi session with explicit model and tool allowlist. Plugin manages invocation cadence and model usage.                         |
| Rich tool result or chart                  | `toolRenderers`                                        | Receives structured tool data. Rendering failure falls back to the normal result card.                                                    |
| Rich extension message                     | `messageRenderers`                                     | Receives normalized message, custom type, and structured details.                                                                         |
| “Turn this reply into a task”              | `messageActions`, server `action`, storage             | Can use a reply without coupling the core UI to a particular task system.                                                                 |
| Another main agent runtime                 | Server plugin `backends`                               | Implements `BackendDefinition`/`AgentBackend`; emits the existing browser contract.                                                       |

Workspace panels declare `scope: "workspace"` and use `WorkspacePluginContext` from `src/plugin-api.ts`. Their actions call `POST /api/projects/:id/plugins/:pluginId/:action` and dispatch to the server plugin's optional `workspaceAction(name, input, context)`. That context contains only `project` and `storage`, with no implicit agent session, model call, transcript, or background-agent constructor. The Notes plugin demonstrates this surface. Plugins needing chat tools can retain a separate session `action` and use the same storage namespace.

Existing panels default to session scope for compatibility. Their callbacks receive an explicit project and session context. Store durable plugin data through `storage.get/set`. `publish` updates that session's panel data and accepts JSON-serializable values. A panel can call `action` to request server work. Tool definitions use Pi's SDK schema; tools intended for other runtimes need their runtime's adapter.

Server event handlers run independently of the main conversation. Catch errors, avoid blocking work, and serialize your own asynchronous updates when order matters. Plugins must prevent recursive reactions to their own actions. Observers can coalesce events or run only after `agent_settled`; continuously launching a new model call for every token is unnecessary.

Background agents default to an empty tool allowlist, use separate native session files, and are disposed with their parent host session. Their interface provides `prompt`, `subscribe`, `stop`, and `dispose`. They do not automatically inherit interactive extension UI, expose a task dashboard, or resume after a restart. Those are explicit future capabilities rather than implied supervisor behavior.

## Limits worth preserving

- This is a small local extension interface, not a promise that every future idea fits version 1. New UI placement, replacing the main composer, or new runtime interaction semantics may need host changes.
- An existing terminal component cannot be translated generically from its JavaScript factory. Adapt the extension to standard dialogs or provide a browser-specific implementation.
- A plugin can add application behavior through source changes as well as these hooks. The project remains ordinary TypeScript/React code that Pi can edit through prompting.
- Changing the prototype through prompting does not bypass the selected skill's own instruction to review or wait before implementation.

See `docs/evaluation.md` for the architecture probes that were actually run, rather than treating these interfaces alone as proof of compatibility.
