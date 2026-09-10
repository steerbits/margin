# Architecture and extensions

```
React interface ─── normalized messages, comments, dialogs, snapshots
        │
Local HTTP + SSE host ─── AgentBackend contract
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

Both use a unique lowercase `id` and `apiVersion: 1`. Server plugins load at startup; browser plugins are bundled by Vite. Restart during development, or rebuild and restart production, after adding a plugin. Plugin code executes with the same privileges as the app and is intended for your own trusted code.

## Available extension points

| Idea                                       | APIs involved                                          | Boundary                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Project notes, decisions, or issue tracker | Panel + server `action`, project `storage`, Pi `tools` | Storage is project-scoped; published panel state is session-scoped. Load data when mounting/switching sessions and refresh after actions. |
| Activity monitor                           | `onEvent`, `getMessages`, `publish`, panel             | Uses public agent/tool activity; does not inspect hidden model internals.                                                                 |
| Supervisor/summarizer                      | `createAgent`, `subscribe`, `prompt`, panel            | Independent Pi session with explicit model and tool allowlist. Plugin manages invocation cadence and model usage.                         |
| Rich tool result or chart                  | `toolRenderers`                                        | Receives structured tool data. Rendering failure falls back to the normal result card.                                                    |
| Rich extension message                     | `messageRenderers`                                     | Receives normalized message, custom type, and structured details.                                                                         |
| “Turn this reply into a task”              | `messageActions`, server `action`, storage             | Can use a reply without coupling the core UI to a particular task system.                                                                 |
| Another main agent runtime                 | Server plugin `backends`                               | Implements `BackendDefinition`/`AgentBackend`; emits the existing browser contract.                                                       |

Callbacks receive an explicit project and session context. Store durable plugin data through `storage.get/set`. `publish` updates that session's panel data and accepts JSON-serializable values. A panel can call `action` to request server work. Tool definitions use Pi's SDK schema; tools intended for other runtimes need their runtime's adapter.

Server event handlers run independently of the main conversation. Catch errors, avoid blocking work, and serialize your own asynchronous updates when order matters. Plugins must prevent recursive reactions to their own actions. Observers can coalesce events or run only after `agent_settled`; continuously launching a new model call for every token is unnecessary.

Background agents default to an empty tool allowlist, use separate native session files, and are disposed with their parent host session. Their interface provides `prompt`, `subscribe`, `stop`, and `dispose`. They do not automatically inherit interactive extension UI, expose a task dashboard, or resume after a restart. Those are explicit future capabilities rather than implied supervisor behavior.

## Limits worth preserving

- This is a small local extension interface, not a promise that every future idea fits version 1. New UI placement, replacing the main composer, or new runtime interaction semantics may need host changes.
- An existing terminal component cannot be translated generically from its JavaScript factory. Adapt the extension to standard dialogs or provide a browser-specific implementation.
- A plugin can add application behavior through source changes as well as these hooks. The project remains ordinary TypeScript/React code that Pi can edit through prompting.
- Changing the prototype through prompting does not bypass the selected skill's own instruction to review or wait before implementation.

See `docs/evaluation.md` for the architecture probes that were actually run, rather than treating these interfaces alone as proof of compatibility.
