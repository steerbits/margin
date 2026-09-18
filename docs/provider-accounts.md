# Connect a provider in Margin

## First-time setup

1. For a fresh native installation, use `bash install.sh --start` (Node 22.19+; cco is bundled). For later starts, use `bash start.sh`; changed local versions rebuild automatically. See [installation and startup](installation.md) for existing installations and same-version edits.
2. Open the connection link printed in Terminal. This authorizes your browser to use your local Margin server; it is separate from provider sign-in.
3. On a fresh installation, choose **Connect an AI provider**. Later, open the gear → **AI connections**. Both open the same Settings overlay. All configured providers and custom servers appear under **Saved connections**. Choose **Add connection** to see featured providers or **Browse all providers**. Nothing is selected automatically, and selection uses a neutral outline.
4. Follow Pi's prompts. For browser authorization, click **Open sign-in page**, authorize on the provider's site, and return to Margin. If the callback cannot reach this machine, paste the final redirect URL/code in the fallback field. For device login, open the verification page and enter the displayed code; Margin checks completion automatically.
5. After credentials are saved, models refresh automatically. Pick a default model and thinking effort; changes autosave. **Close** dismisses Settings after pending saves finish. Start a conversation.

Margin uses private Pi storage for this installation. Use Settings to sign in, or run the bundled Pi CLI with npm run pi; a separate global terminal Pi login is not reused automatically. Other people installing Margin connect **their own accounts**; credentials are not bundled with Margin or stored in Git.

## Custom connections

Choose **Add custom connection** inside AI connections. Select an API format, enter the base URL, and choose **API key** or **No authentication** explicitly. The key field is hidden only for the latter. The current Pi Google Generative AI adapter requires a key; the form explains that limitation. OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages support the no-auth option.

**Find models** is optional. Choose a discovered model or enter its exact ID manually when the server does not expose a catalog. **Test & save** sends a small inference request and saves only after a usable reply; provider usage charges may apply. Invalid credentials, unavailable models and connection failures leave the form editable and do not create a saved connection. Closing the dialog or cancelling aborts an unfinished check.

Connections receive a name from their server hostname. **Edit → Advanced** can rename one, override its context/reply limits, enter literal custom headers, and override thinking capabilities when automatic discovery is unavailable. API keys and header values are not returned to the browser when editing: a blank key preserves the saved key only for the same authenticated endpoint and API format. Switching from no-auth to API-key requires a new key. Blank headers preserve saved headers on the same endpoint; `{}` removes them.

Custom entries, keys, and headers live in `.margin-data/pi/models.json`, written atomically with owner-only permissions. Keys/header values must be literals; web input cannot execute Pi shell commands or interpolate environment variables. Unrelated provider entries are retained. Existing Pi line comments/trailing commas are accepted and normalized to JSON when saving. No-auth connections use an internal placeholder for Pi availability; it is removed from outgoing authentication headers. Google uses its native SDK transport; other custom transports reject redirects.

Margin uses a server-reported context limit where available. For llama.cpp it reads the active context from `/props`, never the larger training maximum. Unknown limits use an explicitly described **provisional 16K budget**, which is not a guarantee of capacity; Advanced provides an override. Detection is performed when testing/saving, so retest after changing a server's context configuration. Small custom contexts receive proportional reply headroom and session-local compaction thresholds, avoiding Pi 0.85.1's fixed 4K-reserve behavior without modifying the SDK or global settings.

Connection edits and removals take effect in existing chats before their next user turn; an active response is not retargeted. Removed connections remain visibly unavailable until another model is chosen. Account setup saves when completed. Conversation-default changes autosave; **Close** waits for pending saves. Errors retain the latest choices and offer **Retry saving** or **Close without retrying**. Only acknowledged saves show **Saved**.

## Thinking capabilities

Custom models default to **Server default**, not Off. An unknown capability is different from unsupported thinking. Server default sends no optional thinking override, leaving the server in control.

- **Unknown / server managed:** one Server default state.
- **Unsupported:** one Not supported state.
- **Toggle:** Server default, Off, and On.
- **Effort levels:** Server default plus only the declared levels.
- **Always enabled:** one fixed Always enabled state.

Automatic discovery uses exact catalog models on recognized provider endpoints, explicit server capability declarations, and llama.cpp templates that expose the standard `enable_thinking` toggle. A familiar model name, an OpenAI-compatible protocol, a generic reasoning boolean, or a successful text reply does not establish control support. Catalog models retain the SDK's native API mappings, including budget-based Claude/Gemini models. Context and output limits use reported values where available.

Under **Edit → Advanced → Thinking controls**, an administrator can choose a mode and its documented supported levels. OpenAI-compatible servers can additionally select their reasoning transport (standard API, OpenRouter, chat-template, or llama.cpp). These are explicit overrides, not automatic capability verification. Changing API format resets the thinking override to automatic detection. Legacy boolean-only custom configurations remain server-managed until retested or explicitly configured.

Per-chat custom choices persist independently of conversation defaults. If a capability change makes a saved choice invalid, Margin resets it to Server default, records that reset, and notifies the current chat when refreshed. Stopping a server does not remove its saved connection or switch models; the next request reports the connection error through the existing retry/recovery flow.

The connection test preserves server-default thinking and allows up to 2048 output tokens within the configured reply limit. If thinking consumes that budget without a visible answer, the form explains how to adjust the reply budget/server defaults and does not silently turn thinking off.

## Model pickers

Chat, new-conversation and Settings model pickers share this order, with native horizontal separators between nonempty groups:

1. **Saved Connections** — Pi's active credential is saved in its credential store, including saved API keys as well as browser/device logins.
2. **Keys** — Pi resolves access from environment or runtime credentials rather than a saved connection.
3. **Custom** — access comes from custom configuration/fallbacks; models from other backends without source metadata also appear here.

Only models Pi reports as available are included; grouping does not hide environment/custom access or shorten a connected provider's catalog. Pi's resolved credential source determines the group, not a provider allowlist. For example, removing a saved login can move a provider to **Keys** if an environment credential remains. Empty groups are omitted.

Labels consistently put the connection provider first: **Anthropic • Claude Sonnet** versus **OpenRouter • Anthropic: Claude Sonnet** (illustrative model names). Options sort by provider, then model, within each group without changing automatic-default priority or existing selections. Unavailable saved selections remain explicit rather than appearing silently switched. With no available models, the picker says **Configure a model in Settings**, with a route to provider setup.

Native controls preserve platform keyboard/mobile behavior. Horizontal-rule appearance depends on browser/OS support; group labels remain on platforms that omit rules.

## Providers and billing

The account list and login methods come from the installed Pi SDK, not a Margin allowlist. Pi 0.85.1 currently exposes 40 built-in providers: seven with browser/device OAuth, and 39 with API-key/token/configuration login (these overlap). Global `models.json` providers may add entries. Installing an SDK update may change this list; Margin does not promise future, incompatible prompt types will work without an update.

| Provider | Connection | Important distinction |
| --- | --- | --- |
| ChatGPT / Codex | Browser or device-code sign-in | Eligible ChatGPT/Codex subscription; separate from OpenAI API billing |
| Anthropic / Claude | Browser sign-in or API key | Pi documents Pro/Max third-party access as **separately billed extra usage**, not included plan limits |
| xAI / Grok | Device-code subscription sign-in or API key | Pi advertises SuperGrok/X sign-in; eligibility and limits depend on your plan |
| GitHub Copilot | Device-code sign-in or token | Pi can ask for an Enterprise domain; organization/model policies still apply |
| OpenRouter | Browser sign-in or API key | Browser sign-in creates a key billed from OpenRouter credits |
| Kimi Code, Radius | SDK-provided OAuth and key methods | Account eligibility and provider billing apply |
| Gemini, DeepSeek, Mistral, OpenAI and other API providers | API-key/configuration prompts | API access is not automatically included in a consumer chat subscription |
| AWS / Google Cloud and configured providers | Methods advertised by Pi | Some require external IAM, environment, project or region configuration; Margin does not add a separate cloud setup wizard |

“Configured” means Pi found credentials, not that Margin has made a paid test request or verified every model. Model availability also depends on the SDK catalog and provider permissions. Margin does not switch providers or billing accounts silently when a request fails.

Provider behavior is delegated to Pi. For example, its Copilot login can enable models permitted by the account. Review provider authorization screens and applicable terms; SDK support is not a guarantee of plan eligibility. [Pi provider documentation](https://pi.dev/docs/latest/providers).

## Storage and account changes

- Pi owns token exchange, credential-file locking, persistence and OAuth refresh. Credentials normally live in `.margin-data/pi/auth.json`, created by Pi with owner-only permissions. The launcher sets `PI_CODING_AGENT_DIR` to the configured Margin data directory’s `pi/` child.
- Account actions save when completed. Conversation defaults also autosave when changed; no second Save is required. Reconnecting replaces that provider's one saved credential. Removing a login requires confirmation and removes it from this installation’s Pi CLI too; this is local credential removal, not provider-side token revocation.
- Existing chats retain their selected model. Subsequent requests can use changed credentials or fail after removal. Environment variables and externally configured credentials may still provide access after removing the saved login.
- Access/refresh tokens are never returned to the browser or copied into Margin's database. API keys and pasted codes travel from the browser to the authenticated local server for submission, but are not kept in localStorage, sessionStorage or chat history. Login links and device user codes are necessarily visible while signing in.
- Settings accepts literal API keys. Pi's advanced shell-command/environment key expressions remain a Terminal/config-file setup, not an executable web input.

## Cancellation and recovery

One account operation runs at a time in each Margin host process. **Cancel sign-in** or closing Settings cancels an unfinished interaction. Attempts expire after ten minutes; hard tab closes/network interruptions may rely on that deadline. Reopening Settings can pick up an attempt still running in the server. Restarting the server loses unfinished interactions, not saved credentials.

A browser callback can finish while the manual fallback field is open; its cancellation is handled without treating a successful login as failure. Replies to superseded prompts are rejected. If Pi saved credentials but failed to synchronize its model state, Margin reports the saved result and asks you to refresh models or restart—not to repeat the credential mutation blindly.

Use **Refresh provider accounts** after signing in externally through `pi` → `/login`. If a model is still missing, check its provider permissions/catalog and use Pi's model-update tools. Close other simultaneous terminal logins if they occupy an OAuth callback port. Raw provider error bodies are intentionally not exposed because they can contain secrets; login errors show safe troubleshooting guidance instead.

`MARGIN_AUTH_READ_ONLY=1` disables both login and removal in Settings and blocks credential refresh. Launch without it for normal account management. This mode remains useful for restricted environments that can only read an existing Pi login.

## Boundaries and verification

Provider account routes live on the authenticated gateway (or the legacy standalone native host), not project workers. Loading the gateway's `ModelRuntime` does not start agent sessions or load project extensions. Existing host/Origin/cookie/JSON guards protect these endpoints. This remains a personal, loopback-only application—not multi-user account isolation or a hosted OAuth broker. Custom connections are edited in Settings and stored in the installation-owned Pi configuration. Project-only provider-extension account management is not included.

Automated coverage includes SDK credential persistence in disposable directories, owner-only file permissions, fresh-runtime Claude/Grok model discovery, Claude/Grok session-default restoration, and the real xAI device-code implementation with mocked HTTP. Browser tests exercise generic authorization, fallback, secret entry, cancellation, server-lost interaction recovery, model refresh, mobile layout and shared-login removal confirmation. Gateway tests check authentication, cross-origin rejection and read-only enforcement. Tests do not authenticate a real vendor account or make live Claude/Grok inference requests; those remain manual checks. No live Margin process was restarted. See [AI connections evaluation](ai-connections-review.md) for custom-provider coverage, screenshots, and live OpenRouter/Codex results.
