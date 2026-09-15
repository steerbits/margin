import type { Project, SessionInfo } from "../shared/types.ts";

export function isActiveConversation(session: SessionInfo) {
  return ["running", "waiting"].includes(session.activity?.status ?? "idle");
}

/** Active first, then most recently updated; never depend on stream arrival order. */
export function orderConversations(sessions: SessionInfo[]) {
  return [...new Map(sessions.map((s) => [s.id, s])).values()].sort(
    (a, b) =>
      Number(isActiveConversation(b)) - Number(isActiveConversation(a)) ||
      b.updatedAt - a.updatedAt ||
      a.id.localeCompare(b.id),
  );
}

/** A soft limit: all active chats and the selected chat must remain reachable. */
export function visibleConversations(
  ordered: SessionInfo[],
  limit: number,
  expanded: boolean,
  selectedId?: string | null,
) {
  if (expanded) return ordered;
  const included = new Set(
    ordered
      .filter((s) => isActiveConversation(s) || s.id === selectedId)
      .map((s) => s.id),
  );
  for (const session of ordered) {
    if (included.size >= limit) break;
    included.add(session.id);
  }
  return ordered.filter((s) => included.has(s.id));
}

/** Search loaded metadata, not transcripts; whitespace-separated terms all match. */
export function searchConversations(
  ordered: SessionInfo[],
  projects: Project[],
  query: string,
) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  return ordered.filter((s) => {
    const text =
      `${s.title} ${names.get(s.projectId) ?? ""}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
