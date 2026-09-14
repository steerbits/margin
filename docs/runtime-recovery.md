# Runtime recovery and long-run stability

## Activate this update

After active work has finished, stop the existing Margin launch with **Ctrl+C**, run **`npm start`**, and refresh the browser. The build is already verified. This first clean restart is necessary: older running workers do not have the new ownership or recovery records. Do not start a second launch alongside them.

## What changed

### Slow browsers no longer accumulate unlimited conversation copies

Each live connection keeps at most one backpressured write plus the latest pending snapshot. Intermediate snapshots can be skipped, but saved messages, comments, drafts, and the latest state are not discarded. Serialization is deferred while the socket is blocked, and heartbeats do not add more queued writes.

A connection stalled for 30 seconds is closed so EventSource can reconnect. This closes only that browser subscription; it does not stop Pi or start another agent.

### Runtime exits are visible and recorded

Each workspace's data directory contains:

- `runtime/events.jsonl`, plus one rotated backup: structured lifecycle events, actual runtime and launcher PIDs, generation, exit code/signal, known OOM classification, periodic heap/RSS samples, and slow-stream queue measurements.
- `runtime/owner.sqlite`: exclusive runtime ownership and active managed-command guardian records. This is separate from Git's history-operation lock.

For Margin's source workspace these are under `.margin-data/runtime/`. Other workspaces use `.margin-data/workspace-data/<workspace ID>/runtime/`.

Logs are permission-restricted and bounded to approximately 256 KiB per file. They do not persist raw stderr/stdout, prompts, credentials, or bearer tokens. A known OOM classification survives even when a long native stack displaces its first line from the bounded diagnostic tail. Unexpected exits are also reported in Terminal and the recovered conversation's notice.

### A disconnected launcher is not assumed to be a dead agent

The runtime claims a persisted ownership generation before plugins or sessions start. Competing gateways cannot claim it while the recorded runtime is alive or its death cannot be verified. There is no heartbeat/lease timeout that could mistake computer sleep for death.

The ready handshake includes the actual runtime PID and generation. A wrapper-only exit keeps the existing worker connection if its runtime is still alive. If an entirely new gateway finds an old live runtime, it refuses to start a second agent rather than guessing or killing an unidentified process. Permission-limited liveness checks and PID reuse also fail closed; inspect the owner before taking manual recovery action, and do not blindly delete ownership storage.

### Managed Bash commands have a crash guardian

Margin's default Bash tool uses a short-lived Node guardian with an IPC connection to its SDK host. On macOS/POSIX, losing that IPC connection kills the guardian's process group, including ordinary in-flight shell children. The guardian is registered before receiving its command, and a replacement runtime waits until both the previous runtime and its registered guardians are confirmed dead.

The guardian stays active while post-shell-exit output is still arriving. Normal output, exit codes, timeout/abort behavior, and output-tail draining are covered by tests.

This is not a general OS process sandbox or an exactly-once guarantee for external effects. Deliberately detached/reparented processes, custom tools or extensions that bypass the default Bash tool, and quiet background services intentionally left running after a completed command retain their own lifecycle behavior. Saved tool results are not proof that every external side effect is reversible.

## When automatic continuation happens

An unexpectedly interrupted **active** run can receive one automatic continuation prompt when its conversation is loaded, after safe worker takeover. The prompt tells Pi to continue the original task from saved history/current files, verify existing results, and not blindly repeat actions or expand scope. It does not submit newer composer drafts or draft feedback.

The attempt is recorded before sending it. Browser reconnects, concurrent loads, and another crash cannot reset that budget. Only a new human send starts a fresh budget.

Automatic continuation is refused when:

- The user pressed Stop, including during replacement initialization.
- The run had already finished or the restart was requested.
- An unanswered dialog, background-agent operation, or tracked plugin operation was pending.
- A started tool has no durably saved native result. `tool_execution_end` alone is insufficient.
- The original input cannot be confirmed in saved history.
- The previous runtime identity cannot be verified, or the run already used its recovery attempt.
- A new startup question/background operation requires attention.

Those cases remain available for manual inspection and continuation, with an explanatory notice. In-progress tool promises cannot be restored. Historical runs without the new recovery metadata also remain manual. Inactive conversations are recovered when loaded, not proactively awakened by sidebar polling.

## History warnings

The existing code-history protections remain intentional: Margin-source chat/feedback sends still create an automatic checkpoint, and conflicting active work still blocks history/plugin changes. Source-workspace sends now wait for their own session initialization before checking idleness, avoiding a rejection caused solely by that initialization.

`history/operation.lock` has not been replaced by the runtime owner database, and neither mechanism creates a Git worktree. This update does not assume that every historical history-lock warning had the same cause.

## Observed verification

The same isolated production-handler probe used for diagnosis was rerun with a 0.58 MiB snapshot, 100 updates, and a stalled browser:

| Measurement | Before | After |
|---|---:|---:|
| Final queued worker output | 48.84 MiB | 0.53 MiB |
| Retained heap growth after GC | 99.91 MiB | 2.54 MiB |
| Queue at updates 25 / 50 / 75 / 100 | 9.45 / 22.58 / 35.71 / 48.84 MiB | 0.53 / 0.53 / 0.53 / 0.53 MiB |

Both healthy controls drained to zero queued output. Disconnect/reconnect left zero/one subscription respectively, without stopping the synthetic agent. The probe used disposable HTTP ports, no model inference, and no live app requests. Heap and queued-byte measurements are different quantities; neither is an application-wide memory cap.

- `npm test`: **109 passed**, including real subprocess death, guardian cleanup, wrapper-only survival, concurrent-start/ownership checks, interrupted-tool and explicit-Stop regressions, adapter-level automatic prompting, bounded logs, and actual HTTP backpressure.
- `npm run build`: **passed**. The existing browser bundle-size warning remains.
- `npm run test:e2e`: **55 passed**.
- `npm run test:gateway`: **7 passed**. One stale test assumption was corrected: Customize selects Margin's workspace, so another workspace's conversation row is not in that sidebar. The test now verifies cross-workspace completion through summaries before navigating to the other workspace to inspect its unread badge. No sidebar behavior was changed.

Gateway browser/lifecycle tests use a cco shim for process and HTTP routing, not a new OS-sandbox enforcement test. Recovery adapter tests stub the model boundary; no paid provider inference, physical sleep/screensaver cycle, or intentional real OOM was performed. These results demonstrate the buffering fix and tested recovery safeguards, not immunity to every possible future crash.

The original incident evidence is preserved in [the baseline diagnosis](run-interruption-diagnosis.md).
