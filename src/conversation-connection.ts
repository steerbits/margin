import type { Snapshot } from "../shared/types.ts";

type Stream = Pick<
  EventSource,
  "close" | "onmessage" | "onerror" | "addEventListener"
>;
interface ConnectionEnvironment {
  window: EventTarget;
  document: EventTarget & { visibilityState: string };
  open: (url: string) => Stream;
  now: () => number;
}

/** Reattach to the server's current snapshot, never resend a prompt. Keeps the
 * React tree, composer, comment editor and scroll position alive across sleep.
 */
export function connectConversation(
  options: {
    sessionId: string;
    onSnapshot: (snapshot: Snapshot) => void;
    onConnection: (connected: boolean) => void;
  },
  environment: ConnectionEnvironment = {
    window,
    document,
    open: (url) => new EventSource(url),
    now: Date.now,
  },
) {
  let disposed = false;
  let stream: Stream | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let wakeTimer: ReturnType<typeof setTimeout> | undefined;
  let retryMs = 1000;
  let lastSeen = environment.now();
  let openedAt = lastSeen;
  let receivedSnapshot = false;
  const closeStream = () => {
    const previous = stream;
    stream = undefined; // Invalidate late events before closing the old socket.
    previous?.close();
  };
  const scheduleRetry = () => {
    if (disposed) return;
    closeStream();
    options.onConnection(false);
    if (retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 15_000);
  };
  const connect = () => {
    if (disposed) return;
    if (retry) clearTimeout(retry);
    retry = undefined;
    closeStream();
    options.onConnection(false);
    receivedSnapshot = false;
    openedAt = lastSeen = environment.now();
    try {
      const current = environment.open(
        `/api/sessions/${options.sessionId}/events`,
      );
      stream = current;
      current.onerror = () => {
        if (stream === current) scheduleRetry();
      };
      current.addEventListener("heartbeat", () => {
        if (stream === current) lastSeen = environment.now();
      });
      current.onmessage = (event) => {
        if (disposed || stream !== current) return;
        let snapshot: Snapshot;
        try {
          snapshot = JSON.parse(event.data).snapshot;
          if (
            snapshot.session.id !== options.sessionId ||
            !Array.isArray(snapshot.messages)
          )
            throw new Error("Invalid conversation snapshot");
        } catch {
          scheduleRetry();
          return;
        }
        receivedSnapshot = true;
        lastSeen = environment.now();
        retryMs = 1000;
        options.onSnapshot(snapshot);
        options.onConnection(true);
      };
    } catch {
      scheduleRetry();
    }
  };
  // OS wake has no portable browser event. Focus/visibility/pageshow/online are
  // hints; the clock/heartbeat watchdog also catches a foreground tab resuming
  // without any of those events, or an EventSource stuck in CLOSED/OPEN.
  const wake = () => {
    if (
      disposed ||
      environment.document.visibilityState === "hidden" ||
      wakeTimer
    )
      return;
    wakeTimer = setTimeout(() => {
      wakeTimer = undefined;
      connect();
    }, 100);
  };
  const offline = () => {
    if (disposed) return;
    if (wakeTimer) clearTimeout(wakeTimer);
    wakeTimer = undefined;
    scheduleRetry();
  };
  const watchdog = setInterval(() => {
    const now = environment.now();
    if (
      stream &&
      (now - lastSeen >= 45_000 ||
        (!receivedSnapshot && now - openedAt >= 45_000))
    )
      connect();
  }, 5000);
  environment.window.addEventListener("focus", wake);
  environment.window.addEventListener("online", wake);
  environment.window.addEventListener("pageshow", wake);
  environment.window.addEventListener("offline", offline);
  environment.document.addEventListener("visibilitychange", wake);
  connect();
  return () => {
    disposed = true;
    closeStream();
    clearInterval(watchdog);
    if (retry) clearTimeout(retry);
    if (wakeTimer) clearTimeout(wakeTimer);
    environment.window.removeEventListener("focus", wake);
    environment.window.removeEventListener("online", wake);
    environment.window.removeEventListener("pageshow", wake);
    environment.window.removeEventListener("offline", offline);
    environment.document.removeEventListener("visibilitychange", wake);
  };
}
