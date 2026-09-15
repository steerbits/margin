# Connect a provider in Margin

## First-time setup

1. Install and launch Margin normally (`npm ci --ignore-scripts`, `npm run build`, `npm start`; Node 22.13+ and cco are required).
2. Open the connection link printed in Terminal. This authorizes your browser to use your local Margin server; it is separate from provider sign-in.
3. Open the gear → **Provider accounts**. Search/select your provider and choose its sign-in or API-key/configuration method.
4. Follow Pi's prompts. For browser authorization, click **Open sign-in page**, authorize on the provider's site, and return to Margin. If the callback cannot reach this machine, paste the final redirect URL/code in the fallback field. For device login, open the verification page and enter the displayed code; Margin checks completion automatically.
5. After credentials are saved, models refresh automatically. Pick a default model and thinking effort, then **Save**. Start a conversation.

If terminal Pi is already authenticated, Margin reuses that login. No second provider sign-in is required when both run as the same OS user with the same Pi configuration directory. Other people installing Margin connect **their own accounts**; credentials are not bundled with Margin or stored in Git.

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

- Pi owns token exchange, credential-file locking, persistence and OAuth refresh. Credentials normally live in `~/.pi/agent/auth.json`, created by Pi with owner-only permissions. `PI_CODING_AGENT_DIR` changes the shared configuration directory.
- Account actions save **immediately**, separately from Margin's conversation-default Save/Cancel. Reconnecting replaces that provider's one saved credential. Removing a login requires confirmation and removes it from terminal Pi too; this is local credential removal, not provider-side token revocation.
- Existing chats retain their selected model. Subsequent requests can use changed credentials or fail after removal. Environment variables and externally configured credentials may still provide access after removing the saved login.
- Access/refresh tokens are never returned to the browser or copied into Margin's database. API keys and pasted codes travel from the browser to the authenticated local server for submission, but are not kept in localStorage, sessionStorage or chat history. Login links and device user codes are necessarily visible while signing in.
- Settings accepts literal API keys. Pi's advanced shell-command/environment key expressions remain a Terminal/config-file setup, not an executable web input.

## Cancellation and recovery

One account operation runs at a time in each Margin host process. **Cancel sign-in** or closing Settings cancels an unfinished interaction. Attempts expire after ten minutes; hard tab closes/network interruptions may rely on that deadline. Reopening Settings can pick up an attempt still running in the server. Restarting the server loses unfinished interactions, not saved credentials.

A browser callback can finish while the manual fallback field is open; its cancellation is handled without treating a successful login as failure. Replies to superseded prompts are rejected. If Pi saved credentials but failed to synchronize its model state, Margin reports the saved result and asks you to refresh models or restart—not to repeat the credential mutation blindly.

Use **Refresh provider accounts** after signing in externally through `pi` → `/login`. If a model is still missing, check its provider permissions/catalog and use Pi's model-update tools. Close other simultaneous terminal logins if they occupy an OAuth callback port. Raw provider error bodies are intentionally not exposed because they can contain secrets; login errors show safe troubleshooting guidance instead.

`MARGIN_AUTH_READ_ONLY=1` disables both login and removal in Settings and blocks credential refresh. Launch without it for normal account management. This mode remains useful for restricted environments that can only read an existing Pi login.

## Boundaries and verification

Provider account routes live on the authenticated gateway (or the legacy standalone native host), not project workers. Loading the gateway's `ModelRuntime` does not start agent sessions or load project extensions. Existing host/Origin/cookie/JSON guards protect these endpoints. This remains a personal, loopback-only application—not multi-user account isolation or a hosted OAuth broker. Custom provider editors and project-only provider-extension account management are not included.

Automated coverage includes SDK credential persistence in disposable directories, owner-only file permissions, fresh-runtime Claude/Grok model discovery, Claude/Grok session-default restoration, and the real xAI device-code implementation with mocked HTTP. Browser tests exercise generic authorization, fallback, secret entry, cancellation, server-lost interaction recovery, model refresh, mobile layout and shared-login removal confirmation. Gateway tests check authentication, cross-origin rejection and read-only enforcement. Tests do not authenticate a real vendor account or make live Claude/Grok inference requests; those remain manual checks. No live Margin process was restarted.
