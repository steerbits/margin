import { useEffect, useState, type RefObject } from "react";
import type { SessionActivity } from "../shared/types.ts";
// A null marker is an explicit reminder: automatic visibility checks must not
// clear it, including after a reload. Strings acknowledge a particular completion.
type ReadMarkers = Record<string, string | null>;
function savedRead(): ReadMarkers {
  try {
    const saved = JSON.parse(localStorage.getItem("margin.read") ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([, value]) => value === null || typeof value === "string",
      ),
    ) as ReadMarkers;
  } catch {
    return {};
  }
}
export function useUnread(
  id: string | null,
  activity: SessionActivity | undefined,
  visible: boolean,
  scroller: RefObject<HTMLDivElement | null>,
  contentVersion?: string,
) {
  const [read, setRead] = useState(savedRead);
  function save(next: ReadMarkers) {
    localStorage.setItem("margin.read", JSON.stringify(next));
    setRead(next);
  }
  function markUnread(sessionId: string) {
    save({ ...savedRead(), [sessionId]: null });
  }
  function markRead(sessionId: string, activity?: SessionActivity) {
    save({ ...savedRead(), [sessionId]: activity?.completionId ?? "" });
  }
  function reopen(sessionId: string) {
    const next = savedRead();
    if (next[sessionId] !== null) return;
    delete next[sessionId];
    save(next);
  }
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "margin.read" || event.key === null)
        setRead(savedRead());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (
      !id ||
      !visible ||
      read[id] === null ||
      !activity?.completionId ||
      !activity.replyId ||
      ["running", "waiting"].includes(activity.status) ||
      read[id] === activity.completionId
    )
      return;
    const root = scroller.current;
    const reply = Array.from(
      root?.querySelectorAll<HTMLElement>("[data-reply-end]") ?? [],
    ).find((node) => node.dataset.replyEnd === activity.replyId);
    if (!root || !reply) return;
    let intersecting = false;
    const mark = () => {
      if (
        !intersecting ||
        document.visibilityState !== "visible" ||
        !document.hasFocus()
      )
        return;
      const rect = reply.getBoundingClientRect();
      const top = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      if (
        !top ||
        !(top === reply || reply.contains(top) || top.contains(reply))
      )
        return;
      const latest = savedRead();
      // A manual action in this or another tab wins over a queued observer.
      if (latest[id] === null) return;
      save({ ...latest, [id]: activity.completionId! });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        intersecting = entry.isIntersecting;
        mark();
      },
      { root, threshold: 1 },
    );
    observer.observe(reply);
    window.addEventListener("focus", mark);
    document.addEventListener("visibilitychange", mark);
    return () => {
      observer.disconnect();
      window.removeEventListener("focus", mark);
      document.removeEventListener("visibilitychange", mark);
    };
  }, [
    id,
    activity?.completionId,
    activity?.replyId,
    activity?.status,
    visible,
    read,
    scroller,
    contentVersion,
  ]);
  return {
    isUnread: (sessionId: string, activity?: SessionActivity) =>
      read[sessionId] === null ||
      (!!activity?.completionId && read[sessionId] !== activity.completionId),
    markUnread,
    markRead,
    reopen,
  };
}
