/** Only failed model messages qualify, never tool errors or explicit aborts.
 * Do not turn quota, authentication, or ordinary server errors into offline waits.
 */
export function isNetworkInterruption(
  message:
    | {
        role: string;
        stopReason?: string;
        errorMessage?: string;
      }
    | undefined,
) {
  if (message?.role !== "assistant" || message.stopReason !== "error")
    return false;
  const text = message.errorMessage ?? "";
  if (
    /\b(401|403|429)\b|auth|api.?key|quota|billing|usage.?limit|context.?length/i.test(
      text,
    )
  )
    return false;
  return /websocket.*(timeout|closed|error)|\b(fetch failed|failed to fetch|network.?error|connection.?(lost|refused|reset)|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|other side closed|terminated)\b|\b(idle timeout|connect timeout|connection timed? out|stream ended before|stream ended without)/i.test(
    text,
  );
}

// Added only after Pi's normal retry budget is exhausted. Sleep suspends these
// timers; waking does not create extra attempts or reset the per-human-run cap.
export const networkRetryDelays = [15_000, 30_000, 60_000] as const;

export function waitForNetworkRetry(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    timer.unref?.();
    signal.addEventListener("abort", finish, { once: true });
  });
}

export const networkRecoveryPrompt =
  "The model connection failed during the previously requested task. Continue that task from the saved conversation and current workspace state. Check existing results before doing work again; do not blindly repeat commands or external actions. This is automatic network recovery, not a new task or permission to expand scope. Do not submit unsent drafts or answer pending human questions.";
