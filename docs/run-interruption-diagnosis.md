# Margin run interruptions: diagnosis

> Historical baseline, captured before the fix. The implemented behavior and before/after verification are documented in [Runtime recovery](runtime-recovery.md). Source line references and probe observations below describe that baseline.

## Bottom line

There is strong evidence that the reported interruptions are workspace-runtime **out-of-memory crashes**, followed by Margin automatically launching a replacement worker. An isolated test reproduces unbounded memory accumulation in the current live-update path when the browser connection stops consuming data.

The memory defect is demonstrated. Linking it to every historical crash remains a high-confidence inference: the OS reports do not contain JavaScript heap snapshots or Margin workspace IDs.

No application source, settings, dependencies, or running server were changed. This is a one-time diagnosis, not an implemented fix.

## 1. Historical crash evidence

Four macOS reports under `~/Library/Logs/DiagnosticReports/` all contain:

- `SIGABRT` and `node::OOMErrorHandler` / `V8::FatalProcessOutOfMemory`.
- A string-flattening / `Buffer` UTF-8 byte-length allocation stack.
- A timer callback (`node::Environment::RunTimers`).

Their process launch times match Margin launcher-directory creation times within 0.18–0.28 seconds. New Margin launcher directories appear roughly three seconds after each crash, consistent with automatic EventSource reconnection and worker replacement.

| Report filename | Runtime PID | Runtime start after matching launcher directory | New launcher directory after crash |
|---|---:|---:|---:|
| `node-2026-09-14-085926.ips` | 63819 | 0.202 s | 3.010 s |
| `node-2026-09-14-090822.ips` | 90531 | 0.274 s | 3.021 s |
| `node-2026-09-14-100803.ips` | 97455 | 0.182 s | 3.016 s |
| `node-2026-09-14-112601.ips` | 39989 | 0.178 s | 3.247 s |

Report times are September 14, 2026, local UTC+05:30. The 11:26 filename corresponds to capture time 11:25:59.672.

This is not evidence of a fixed maximum run duration: the crashed processes had very different lifetimes. The reports also do not establish that screen dimming, screensaver activation, or computer sleep caused the stalls. Their virtual-memory totals must not be interpreted as physical RAM consumption.

## 2. Demonstrated memory bug

### Code path

- `server/sessions.ts:350–356`: coalesces agent updates into a timer, potentially emitting a snapshot every 35 ms.
- `server/sessions.ts:384–423`: each snapshot includes the complete displayed conversation, including live text/thinking and tool state.
- `server/index.ts:594–614`: serializes the complete snapshot for each subscriber and calls `res.write(...)` without acting on its `false` return value or waiting for `drain`.
- `server/gateway.ts:212–244`: pipes the worker stream to the browser. Downstream backpressure can therefore propagate to the worker, which keeps adding writes anyway.

A throttled or stalled consumer can accumulate many obsolete copies of a large conversation. Long code/thinking runs increase the size and number of updates. A fully closed connection is different: its listener is removed.

### Isolated reproduction

Ran `.margin-data/inspect/interruption-stream-probe.mjs` with:

```sh
node --expose-gc --max-old-space-size=384 .margin-data/inspect/interruption-stream-probe.mjs
```

The probe extracts and executes the current production SSE route and gateway proxy in isolated HTTP servers on disposable ports. The agent is a synthetic event source; it does not make model requests or connect to the running app. Each serialized snapshot is approximately 0.58 MiB. It sends 100 updates at 35 ms intervals and stops well below an OOM condition.

| Measurement | Reading browser control | Stalled browser |
|---|---:|---:|
| Elapsed time | 3.823 s | 4.030 s |
| Worker queued output at end | 0 MiB | 48.84 MiB |
| Retained heap change after GC | -0.06 MiB | +99.91 MiB |
| Queue at updates 25 / 50 / 75 / 100 | 0 / 0 / 0 / 0 MiB | 9.45 / 22.58 / 35.71 / 48.84 MiB |
| Subscription count after disconnect | 0 | 0 |
| Subscription count after reconnect | 1 | 1 |

The queue metric is Node's writable accounting; the heap metric measures actual retained JavaScript heap in the isolated worker-and-gateway probe process. They are not interchangeable. Every large write initially signaled backpressure even in the healthy control; **continued queue growth**, not the boolean alone, demonstrates the defect.

A metadata-only, read-only SQLite query found saved transcripts up to 3.89 MiB in Margin's source workspace and 1.72 MiB in an external workspace. Thus the probe does not require an implausibly large transcript.

This demonstrates the failure mode, not an actual browser sleep/screensaver event or a live Pi long-run memory profile.

## 3. Why the warning appears without a manual restart

With `npm start`, the gateway manages separate workspace workers. `WorkspaceWorkers.get()` reuses the existing worker promise while present. An observed child exit removes that mapping; the next request launches a new worker.

`src/App.tsx:478` uses `EventSource` for live chat, which reconnects automatically. Sidebar summaries are separately polled about every 1.5 seconds. Closing a browser subscription does not intentionally abort the agent.

On the replacement worker, loading the conversation constructs a new `LiveSession`. `server/sessions.ts:139–168` displays the interruption warning if persisted `interrupted` state is true. Initialization then becomes idle. Saved history returns, but the old in-memory agent/tool execution does not resume, producing the visible change from Stop to Reply.

The warning identifies recovery, not the originating crash reason. Ordinary Pi provider/network failures are handled separately through agent errors/retries; they do not by themselves explain this initialization-only notice.

## 4. Can old work survive?

There are three distinct cases:

1. **Browser connection lost, SDK process healthy:** the existing Pi agent intentionally continues. Reconnection normally reuses it; it should not create another agent.
2. **The Node process hosting the SDK dies:** the main Pi agent and in-process plugin background agents die with it. A remote model request may still finish provider-side, but the dead local agent cannot run another tool.
3. **Spawned commands or launcher-only failures:** separate OS processes can survive. The installed Pi Bash executor uses detached process groups. Margin also observes a launcher chain, not a strong, independently enforced exclusive runtime owner.

### Isolated lifecycle checks

Ran `.margin-data/inspect/interruption-process-probe.mjs`:

- Using the actual installed `createLocalBashOperations()`, abruptly killed only the SDK-host fixture. Its detached command continued writing a heartbeat (1 → 6).
- Using the actual installed `tsx` launcher, abruptly killed only that launcher. Its runtime child continued writing a heartbeat (1 → 5 on the final run).

These are native subprocess probes, not nested cco launches or model simulations. All fixture runtimes had five-second self-exit watchdogs. The sandbox denied one cleanup signal to a reparented/exited process group; the harness waited for the watchdogs and removed its temporary files. An initial probe invocation reported that cleanup denial as a failure; the final invocation completed successfully with that limitation reported.

The installed native cco path includes a sandbox wrapper, and the launched command uses tsx. The tests establish that wrapper exit is not universally equivalent to runtime/process-tree exit. They do **not** show that duplicate agents caused the historical OOM incidents.

A single gateway's in-memory map prevents ordinary duplicate startup requests, but it is not cross-process ownership protection. An abrupt gateway failure can also leave detached workers behind, which a newly launched gateway does not discover through that map.

## 5. Exit diagnostics should be retained

`server/workspace-workers.ts:119–184` keeps the last 4,000 characters of worker diagnostics in memory. Startup failures include those diagnostics. Once startup has settled successfully, the later exit error passed to `finish()` is ignored; the exit callback merely removes the worker mapping.

Recommend permission-restricted, size-bounded lifecycle logs with timestamps, workspace identity, launcher and actual runtime identities, exit code/signal, unexpected-vs-requested shutdown, and memory/queue observations. Surface a short actionable notice. Avoid unbounded output logs and exposing credentials, auth URLs, or full conversation content. Record actual runtime identity in the ready handshake, not just the launcher PID.

## 6. Safe automatic continuation

The user's preference is to avoid manually typing “continue.” That is reasonable, but blindly sending it on a reconnect is unsafe: the original worker might still be running, a command may survive, or an action may have completed immediately before its result was saved.

Recommended sequence for a future implementation:

1. **Fix unbounded live-update buffering:** respect backpressure and retain at most the latest pending snapshot for a stalled subscriber, with a bounded slow-consumer policy. Do not pause agent work merely because one browser is slow. Preserve durable conversation history.
2. **Add durable exit diagnostics and memory/queue visibility.** Increasing the heap limit alone is not a fix.
3. **Enforce exclusive worker ownership and verified recovery:** do not launch an acting replacement merely because a socket disconnected or a wrapper exited. Require proof the previous runtime is stopped, and handle surviving managed command processes. Stop recovery rather than guessing if ownership cannot be established.
4. **Then add guarded automatic continuation:** for example, one persisted recovery attempt for an unexpectedly interrupted active run, only after safe takeover. Never auto-continue explicit Stop or answer pending human dialogs. If an unfinished tool has uncertain effects, pause for recovery/reconciliation instead of blindly replaying it. Repeated crashes must not create an infinite retry loop.

The exact continuation policy is a remaining user choice; none of these behavior changes has been implemented. Exclusive worker ownership alone cannot make arbitrary external side effects exactly-once.

## 7. The other two messages

### “Finish or stop active agent work…”

`server/index.ts:268–276` protects Margin code-history/plugin operations. Busy includes initialization, active agent work, pending UI dialogs, and tracked background/plugin operations.

For `npm start`:

- Ordinary external-workspace chat sends do not use the automatic Margin checkpoint guard.
- Every chat/feedback send in Margin's own source workspace calls that guard and saves a “Before customization” checkpoint—even a read-only question. It considers live work in that worker, not just the current conversation.
- Explicit checkpoint/plugin changes through `/api/customize` additionally check all running workspace workers in `server/gateway.ts:434–436`.

There is also an initialization race: `sendBatch()` obtains a new `LiveSession`, initially busy, then checks global idleness before awaiting session readiness. An immediate source-workspace send can therefore be rejected because its own session is still initializing. This is a source-level finding, not established as the user's specific occurrence.

### “Another history operation is running…”

`server/checkpoints.ts:111–145` uses `.margin-data/history/operation.lock` to serialize history operations. The file records the calling Node process PID. Operations include checkpoint saves, preview/capture, restore, and some startup history work.

- Existing lock + PID believed alive (or liveness check failing with something other than `ESRCH`) produces this warning.
- A confirmed-dead owner is recovered automatically.
- Malformed lock contents produce a different warning.
- PID reuse or permission-limited liveness checks can make a stale lock appear active.

No current `operation.lock` was present during the initial inspection; the historical warning's exact cause cannot be recovered from that observation. Normal same-process history calls are synchronous and serialized by JavaScript execution; two quick browser requests alone are not proof of two simultaneously executing history operations.

A checkpoint is a rollback snapshot of permitted Margin source files. It uses Git objects and `refs/margin/checkpoints/`, with a temporary Git index; it does not create a separate worktree or move the ordinary branch/index. Existing projects may themselves be Git worktrees, which the launcher supports, but that is separate from checkpoint implementation.

## 8. Other checks and limits

```sh
node --import tsx --test tests/core.test.ts tests/checkpoints.test.ts tests/customization.test.ts tests/workspace-workers.test.ts
```

**Observed:** 23 tests passed, zero failed. These cover persistence/recovery helpers, checkpoint locking/restoration, plugin catalog behavior, workspace migration, launch plans, and authentication persistence. Existing worker tests do not exercise a live worker crash/restart or slow SSE consumers.

Review was direct source inspection and self-review, not an independent reviewer or simulated user study. Historical native stacks support the diagnosis but cannot locate retained JavaScript objects. No live agent was stopped, no real crash was induced, and no credentials/model calls were used by the probes. Only this diagnostic report is added to version control; the one-time probe scripts are in ignored private inspection storage.
