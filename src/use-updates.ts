import { useEffect, useRef, useState } from "react";
import { api } from "./api.ts";
import type { UpdateStatus } from "../shared/updates.ts";
declare const __MARGIN_BUILD_VERSION__: string;

export function useUpdates(enabled: boolean) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const pending = useRef(false);
  async function refresh(manual = false) {
    if (pending.current) return;
    pending.current = true;
    if (manual) setChecking(true);
    try {
      const next = await api<UpdateStatus>(
        manual ? "/updates/check" : "/updates",
        manual ? {} : undefined,
      );
      if (
        next.runningVersion &&
        next.runningVersion !== __MARGIN_BUILD_VERSION__
      ) {
        next.runningVersion = null;
        next.identityWarning =
          "Browser and running server versions differ. Finish active work, restart Margin, and refresh.";
      }
      setStatus(next);
    } catch {
      setStatus((previous) => ({
        runningVersion: null,
        runningCommit: null,
        manifest: null,
        checkedAt: null,
        ...previous,
        error:
          "Update status unavailable. Restart Margin if this server predates update checking.",
      }));
    } finally {
      pending.current = false;
      setChecking(false);
    }
  }
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    const wake = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [enabled]);
  return { status, checking, refresh: () => refresh(true) };
}
