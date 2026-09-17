export type CustomizeTab = "examples" | "plugins" | "history" | "instructions";
export type Destination =
  | { kind: "home" }
  | { kind: "workspace"; projectId: string; panel?: string; view?: "new" }
  | { kind: "chat"; sessionId: string; panel?: string }
  | { kind: "customize"; tab: CustomizeTab };
export type AppRoute = Destination | { kind: "not-found" };

export function destinationUrl(destination: Destination): string {
  if (destination.kind === "home") return "/";
  if (destination.kind === "customize") return `/customize/${destination.tab}`;
  const path =
    destination.kind === "chat"
      ? `/chats/${encodeURIComponent(destination.sessionId)}`
      : `/workspaces/${encodeURIComponent(destination.projectId)}`;
  const query = new URLSearchParams();
  if (destination.panel) query.set("panel", destination.panel);
  if (destination.kind === "workspace" && destination.view)
    query.set("view", destination.view);
  return query.size ? `${path}?${query}` : path;
}
export const chatUrl = (sessionId: string, panel?: string) =>
  destinationUrl({ kind: "chat", sessionId, panel });
export const workspaceUrl = (projectId: string, panel?: string) =>
  destinationUrl({ kind: "workspace", projectId, panel });
export const customizeUrl = (tab: CustomizeTab = "examples") =>
  destinationUrl({ kind: "customize", tab });

export function parseRoute(pathname: string, search = ""): AppRoute {
  if (pathname === "/") return { kind: "home" };
  const parts = pathname.replace(/\/$/, "").split("/").slice(1);
  if (parts[0] === "customize") {
    const tab = parts[1] ?? "examples";
    if (
      parts.length <= 2 &&
      ["examples", "plugins", "history", "instructions"].includes(tab)
    )
      return { kind: "customize", tab: tab as CustomizeTab };
  }
  if (parts.length === 2 && parts[1]) {
    try {
      const id = decodeURIComponent(parts[1]);
      const panel = new URLSearchParams(search).get("panel") || undefined;
      if (parts[0] === "chats") return { kind: "chat", sessionId: id, panel };
      if (parts[0] === "workspaces")
        return {
          kind: "workspace",
          projectId: id,
          panel,
          ...(new URLSearchParams(search).get("view") === "new"
            ? { view: "new" as const }
            : {}),
        };
    } catch {
      /* Invalid escaping is an unknown destination. */
    }
  }
  return { kind: "not-found" };
}
