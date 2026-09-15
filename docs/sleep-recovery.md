# Laptop sleep and connection recovery

## Activate the update

The running Margin server has **not** been restarted. After active work finishes, stop your existing launch with **Ctrl+C**, start it again with your usual command (`npm start` for the standard launcher), and refresh the browser once. Do not launch a second instance alongside it.

The conversation that already exhausted its retries before this update remains stopped. Open it and send **“Continue from the saved work; check what is already done before repeating actions.”** once when ready. The update does not silently restart historical failed conversations.

## What happens after closing the lid

Closing the lid normally sleeps the laptop; it does not shut down the local worker. Local execution pauses during sleep, but the remote model connection may expire. Margin now treats browser connectivity and model connectivity separately:

| State after waking | Behavior |
| --- | --- |
| Agent still running | Reattach to the same run; do not submit another message. |
| Agent finished while the browser was disconnected | Show the latest complete conversation snapshot. |
| Active task ended in a recognized model-network error | Keep the task active during bounded, cancelable recovery attempts. |
| Tool result is missing, or a question/background operation needs attention | Pause automatic recovery and explain why manual review is needed. |
| Explicit Stop | Stay stopped, even after reconnecting. |

The page is **not reloaded** during recovery. Existing draft handling preserves the composer and comments, including unsaved edits in the current tab. The inline editor and reading position remain mounted. Unacknowledged changes still need saving; “Connected” does not mean every draft has been saved.

## Browser connection

`src/conversation-connection.ts` owns one live EventSource subscription per selected chat:

- Focus, visibility, `pageshow`, and `online` trigger a fresh subscription and full snapshot. A 100 ms debounce combines bursts of wake signals.
- Errors, including a permanently closed EventSource, explicitly reconnect with exponential backoff capped at 15 seconds. Repeated read-only reconnection is allowed; it does not retry sends.
- The server emits a named heartbeat every 20 seconds. A 5-second watchdog replaces a stream with no observable activity for 45 seconds, including a foreground tab that wakes without a browser wake event.
- Replaced subscriptions cannot apply late snapshots. Navigation removes listeners and cancels timers.
- Existing server-side backpressure bounds still apply; changing a browser connection never aborts an agent.

This is not a guarantee of instantaneous wake detection. Browser scheduling, OS suspension, local server availability, and network readiness still determine when a new snapshot arrives.

## Model connection

Pi's normal retries run first. If the final saved assistant message is a recognized transport failure (including the observed WebSocket idle timeout, `terminated`, and `fetch failed`), Margin can add **three recovery rounds**, delayed by **15, 30, and 60 seconds** respectively. Each round can also use Pi's normal per-prompt retries.

While waiting, the conversation remains busy, with an explicit retry status and a working **Stop** button. Margin does not announce that the connection is restored until it has evidence; an attempted recovery is labeled as a retry.

Recovery uses a clearly identified automatic continuation message through the public Pi SDK. It uses saved conversation context and asks the agent to inspect existing results before doing more work. It does **not** replay the original request, restore a dead socket, resubmit a draft, or restore an interrupted tool promise. Automatic continuation messages remain visible in the transcript.

Safety conditions are checked before the wait and again immediately before continuation:

- Original input accepted and confirmed in the saved native transcript.
- Exclusive current worker ownership still valid.
- No tracked tool missing its durably saved native result.
- No pending dialog, background-agent operation, or tracked plugin operation.
- Run not stopped or disposed, and recovery budget not exhausted.

Attempts are reserved durably before prompting. Only a new human send resets the budget; browser wake, reconnects, and a worker replacement do not. Pi's existing retry opt-out is respected. Authentication, quota/rate-limit, ordinary server, and tool errors do not receive these extra network-recovery rounds.

A full shutdown/worker crash is a different case, covered by [runtime recovery](runtime-recovery.md). The existing one-attempt crash-recovery allowance remains separate and does not reset the network allowance.

## Observed verification

- `npm test`: **162 passed**.
- `npm run build`: **passed**; the existing bundle-size warning remains.
- `npm run test:e2e`: **69 passed**.
- `npm run test:gateway`: **8 passed**.
- Real Pi SDK lifecycle test, with only the model stream simulated: one tool action completed, the next model turn failed, Pi exhausted three retries, Margin recovered, the saved tool result reached the next model request, and the tool action executed **once**, not twice. A newer draft was not sent.
- Timer/adapter tests cover an eight-hour clock gap, stale/closed/malformed browser streams, late events, cleanup, durable retry exhaustion, Stop during backoff, a question/background operation appearing during the wait, uncertain tool effects, and non-network errors.
- Browser tests cover reconnecting during an active run, catching up to a completed run without a reload or duplicate send, retaining an offline composer draft and reading position, retaining an unfinished inline comment, and recovery after repeated stream failures.

**Self-review, not independent review:** checked browser reconnection versus execution ownership, retry cancellation/budget persistence, and draft preservation. The classifier was challenged with both expected transport errors and authentication/quota/tool-error counterexamples. Checks exercised actual adapter, SDK and rendered browser behavior, not just the policy helpers.

**Limits:** no physical lid-close/wake cycle, paid provider inference, Safari/WebKit test, or new OS-sandbox enforcement test was run. Gateway tests use the existing cco shim. A prolonged outage while the laptop is awake can exhaust the bounded allowance; in that case Margin explains that you must manually continue after connectivity returns. Custom tools and external side effects are not covered by an exactly-once guarantee. The original five-minute provider idle timeout is intentionally unchanged.
