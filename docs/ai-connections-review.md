# AI connections: implementation and evaluation

Implemented on `codex/ai-connections`, based on `a948fa0`, in an isolated worktree. The active main checkout's uncommitted work was not copied or edited. This branch is ready for review and a later merge; it has not been merged.

## Experience

First-time **Connect an AI provider** opens the existing Settings overlay directly to **AI connections**. The same section manages later changes. Featured providers include ChatGPT/Codex, OpenRouter, Anthropic, and Gemini; the full SDK list remains searchable under **Browse all providers**.

Custom setup presents API format, URL, explicit authentication, optional model discovery/manual ID, and **Test & save**. Names are automatic and editable. Advanced controls contain headers, context/reply limits, and reasoning compatibility. Saving a connection does not silently change existing conversations' model choices.

## Screenshot review

These are actual Playwright screenshots of the rendered implementation. Screenshots 01–10 use isolated fixture data; screenshots 11–12 use the real local Qwen model. None are generated mockups or captures of the user's running app.

- [First installation](../.margin-data/ai-connections-review/01-first-install.png)
- [AI connections in Settings](../.margin-data/ai-connections-review/02-ai-connections.png)
- [OpenRouter API key](../.margin-data/ai-connections-review/03-openrouter-api-key.png)
- [ChatGPT/Codex browser handoff](../.margin-data/ai-connections-review/04-codex-sign-in.png)
- [Custom API-key connection](../.margin-data/ai-connections-review/05-custom-api-key.png)
- [Custom local/no-auth connection](../.margin-data/ai-connections-review/06-custom-local.png)
- [Advanced configuration](../.margin-data/ai-connections-review/07-custom-advanced.png)
- [Mobile custom form](../.margin-data/ai-connections-review/08-custom-mobile.png)
- [Invalid model recovery](../.margin-data/ai-connections-review/09-custom-error.png)
- [Saved connection](../.margin-data/ai-connections-review/10-connection-ready.png)
- [Live llama.cpp connection](../.margin-data/ai-connections-review/11-llama-live-connection.png)
- [Live Qwen tool call and streaming response](../.margin-data/ai-connections-review/12-llama-live-chat.png)

Images and machine-readable live results are ignored local review artifacts. Browser tests regenerate the images.

## Verification

- `npm run check`: **209 tests passed**, followed by TypeScript, production frontend and recovery builds.
- `npx playwright test --config tests/connections.playwright.config.ts`: 14 browser scenarios, covering setup, OpenRouter secret entry/retry, Codex browser handoff/cancel/return, model selectors, existing settings behavior, custom real-HTTP save/edit/remove, and desktop/mobile screenshots.
- `npx playwright test --config tests/connections-gateway.playwright.config.ts`: 2 gateway scenarios. Custom endpoints require authentication and same-origin JSON; read-only mode prevents writes. Separate ports 4348/4349 and disposable app/data directories avoid the live app.
- Custom SDK tests exercise all four API formats over HTTP, no-auth and API-key behavior, 4K active-context handling, secret redaction, owner-only storage, manual models, unknown capacities, JSONC, preserved configuration, removal/reload, and aborting queued saves.
- The session regression exercises Stop while a custom-connection refresh is pending: no subsequent model prompt starts.

Live evaluation on this machine:

| Path | Observed result |
| --- | --- |
| OpenRouter API key | Pi key-entry persistence, a real reply from `openai/gpt-4.1-mini`, and a fresh-runtime credential reload passed. |
| Custom OpenAI-compatible endpoint | Test-and-save against OpenRouter, reload in Margin's catalog, and a real Pi read-tool round trip returning the exact temporary fixture contents passed. |
| ChatGPT/Codex | A real reply from `gpt-5.6-sol` using the existing browser-login credential passed. |
| Local llama.cpp / Qwen3.6 27B | The finished Settings UI discovered the real model, detected its active 4K context, and completed Test & save without an API key. A normal production Margin chat streamed a response, invoked the read tool, and returned exact fixture contents. Reload and stopped-server error checks passed. |

The evaluation used disposable custom/key stores and a read-only view of the existing Codex credential. It verified that the original credential file was unchanged and removed the temporary stores. `scripts/evaluate-connections.ts` reruns these checks explicitly; it sends paid/plan-metered requests.

The finished implementation was subsequently tested against the installed Qwen3.6 27B GGUF using `scripts/evaluate-llama-connection.ts`. It starts a disposable production Margin copy (no test-mode backend or mocked model responses), drives the actual Settings form with Playwright, and exercises the real LiveSession chat path. The tool probe enables only the read tool and selects No skill to keep the test bounded. The active context is 4096 tokens; no manual context override is supplied.

Six live checks passed, with streaming observed. The runner then stopped both owned processes, verified their ports were closed, and removed temporary app data. A separate process/open-file check found no llama process or open model-file handle. Results are in `.margin-data/ai-connections-review/llama-live-results.json`. Earlier attempts uncovered probe setup errors (serving the hidden worktree directly and using Enter instead of Margin's send shortcut); these were corrected before the successful run. No application code changes were needed.

## Limits

- A new human vendor authorization was not performed. Codex browser handoff, cancellation and completion were exercised with controlled UI responses; the live check used an existing authenticated account.
- Google custom connections require API-key authentication because the bundled SDK cannot reliably represent absent authentication for that API format.
- A successful small test request proves inference works, not maximum context capacity, tool support for every model, or account entitlement to an entire catalog.
- Unknown context metadata uses a provisional 16K budget; metadata is refreshed on test/save, not continuously. Retest or use Advanced after changing server limits.
- Mobile viewport layout and persistent dismissal were inspected; a real mobile software keyboard was not exercised.

Independent simulated technical and UX reviews found issues with protocol handling, saved edits, cancellation, and copy. These were corrected and rechecked. Those reviews are not evidence of real-user preference.
