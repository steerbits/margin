import { useEffect, useState } from "react";
import type { SendBlock } from "../shared/source-send.ts";
import { api } from "./api.ts";

/** Ask the owning worker, including background/plugin work absent from chat text. */
export function useSourceSend(sessionId: string | null) {
  const [state, setState] = useState<{
    sessionId: string;
    block: SendBlock | null;
    error?: string;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let timeout: ReturnType<typeof setTimeout>;
    let request: AbortController;
    async function poll() {
      request = new AbortController();
      timeout = setTimeout(() => request.abort(), 5000);
      try {
        const { block } = await api<{ block: SendBlock | null }>(
          `/sessions/${sessionId}/send-availability`,
          undefined,
          "GET",
          request.signal,
        );
        if (!cancelled) setState({ sessionId: sessionId!, block });
      } catch (error) {
        if (!cancelled)
          setState({
            sessionId: sessionId!,
            block: null,
            error: `Could not check running tasks. ${error instanceof Error ? error.message : "Retrying…"}`,
          });
      } finally {
        clearTimeout(timeout);
        if (!cancelled) timer = setTimeout(() => void poll(), 1000);
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(timeout);
      request?.abort();
    };
  }, [sessionId, attempt]);
  const current = state?.sessionId === sessionId ? state : null;
  return {
    checked: !!current,
    disabled: !!sessionId && (!current || !!current.block || !!current.error),
    reason: !sessionId
      ? null
      : !current
        ? "Checking running tasks…"
        : (current.error ?? current.block?.reason ?? null),
    blockingSessionId: current?.block?.sessionId,
    failed: !!current?.error,
    retry: () => setAttempt((n) => n + 1),
  };
}
