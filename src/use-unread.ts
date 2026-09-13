import { useEffect, useState, type RefObject } from "react";
import type { SessionActivity } from "../shared/types.ts";
function savedRead(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("margin.read") ?? "{}");
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
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === "margin.read") setRead(savedRead());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  useEffect(() => {
    if (
      !id ||
      !visible ||
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
      const next = { ...savedRead(), [id]: activity.completionId! };
      localStorage.setItem("margin.read", JSON.stringify(next));
      setRead(next);
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
  return (sessionId: string, activity?: SessionActivity) =>
    !!activity?.completionId && read[sessionId] !== activity.completionId;
}
