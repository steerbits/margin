import { useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Project, SessionActivity, SessionInfo } from "../shared/types.ts";
import {
  isActiveConversation,
  orderConversations,
  searchConversations,
  visibleConversations,
} from "./sidebar-conversations.ts";

const statusLabels = {
  idle: "Ready",
  running: "Running",
  waiting: "Waiting for you",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

export function SidebarConversations({
  sessions,
  projects,
  projectId,
  sessionId,
  isUnread,
  onSelect,
  onPrefetch,
  onContextMenu,
}: {
  sessions: SessionInfo[];
  projects: Project[];
  projectId: string;
  sessionId: string | null;
  isUnread: (id: string, activity?: SessionActivity) => boolean;
  onSelect: (id: string) => Promise<boolean>;
  onPrefetch: (id: string) => void;
  onContextMenu: (session: SessionInfo, x: number, y: number) => void;
}) {
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [otherExpanded, setOtherExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const ordered = orderConversations(sessions);
  const current = ordered.filter((s) => s.projectId === projectId);
  const other = ordered.filter((s) => s.projectId !== projectId);
  const searching = !!query.trim();
  const results = searching
    ? searchConversations(ordered, projects, query)
    : [];
  const names = new Map(projects.map((p) => [p.id, p.name]));

  async function open(id: string) {
    if (await onSelect(id)) setQuery("");
  }
  function row(s: SessionInfo) {
    const status = s.activity?.status ?? "idle";
    const unread = isUnread(s.id, s.activity);
    const label = `${s.title} — ${names.get(s.projectId) ?? "Workspace unavailable"} — ${statusLabels[status]}${unread ? " · Unread" : ""}`;
    return (
      <button
        className={sessionId === s.id ? "selected" : ""}
        key={s.id}
        data-session-id={s.id}
        onClick={() => void open(s.id)}
        onMouseEnter={() => onPrefetch(s.id)}
        onFocus={() => onPrefetch(s.id)}
        onContextMenu={(event) => {
          event.preventDefault();
          onContextMenu(s, event.clientX, event.clientY);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onContextMenu(s, rect.left + 20, rect.bottom);
          }
        }}
        aria-haspopup="menu"
        aria-current={sessionId === s.id ? "page" : undefined}
        aria-label={label}
        title={label}
      >
        <span className="session-title">{s.title}</span>
        {status === "running" ? (
          <span
            className="conversation-spinner"
            role="img"
            aria-label="Running"
            title="Running"
          />
        ) : status === "waiting" ? (
          <span
            className="conversation-waiting"
            role="img"
            aria-label="Waiting for you"
            title="Waiting for you"
          >
            !
          </span>
        ) : unread ? (
          <span
            className="conversation-unread"
            role="img"
            aria-label="Unread"
            title="Unread"
          />
        ) : null}
      </button>
    );
  }
  function section(
    items: SessionInfo[],
    id: string,
    title: string,
    limit: number,
    expanded: boolean,
    toggle: () => void,
    empty: string,
    selected?: string | null,
  ) {
    const visible = visibleConversations(items, limit, expanded, selected);
    const collapsed = visibleConversations(items, limit, false, selected);
    const active = items.filter(isActiveConversation).length;
    return (
      <section
        className={`sidebar-chat-section ${id}`}
        aria-labelledby={`${id}-heading`}
      >
        <div className="section-label" id={`${id}-heading`}>
          <span>{title}</span>
          {active > 0 && (
            <span className="section-active-count">{active} active</span>
          )}
        </div>
        <nav className="session-list" id={`${id}-list`} aria-label={title}>
          {visible.map(row)}
          {!items.length && <p className="sidebar-empty">{empty}</p>}
        </nav>
        {items.length > collapsed.length && (
          <button
            className="sidebar-show-all"
            aria-expanded={expanded}
            aria-controls={`${id}-list`}
            onClick={toggle}
          >
            {expanded ? "Show less" : `Show all (${items.length})`}
          </button>
        )}
      </section>
    );
  }
  return (
    <>
      <div className="sidebar-conversations">
        {searching ? (
          <section
            className="sidebar-chat-section sidebar-search-results"
            aria-labelledby="chat-search-heading"
          >
            <div className="section-label" id="chat-search-heading">
              <span>Search results</span>
              <span className="section-active-count" role="status">
                {results.length} {results.length === 1 ? "chat" : "chats"}
              </span>
            </div>
            <nav className="session-list" aria-label="Search results">
              {results.map(row)}
              {!results.length && (
                <p className="sidebar-empty">
                  No matching chats. Try a chat title or workspace name.
                </p>
              )}
            </nav>
          </section>
        ) : (
          <>
            {section(
              current,
              "current-workspace-chats",
              "Conversations",
              5,
              expandedProject === projectId,
              () =>
                setExpandedProject(
                  expandedProject === projectId ? null : projectId,
                ),
              "Your conversations will appear here.",
              sessionId,
            )}
            {section(
              other,
              "other-workspace-chats",
              "Other workspaces",
              10,
              otherExpanded,
              () => setOtherExpanded(!otherExpanded),
              "Chats from other workspaces will appear here.",
            )}
          </>
        )}
      </div>
      <div className="sidebar-search" role="search" aria-label="Conversations">
        <Search size={15} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          aria-label="Search all chats"
          placeholder="Search all chats…"
          title="Search chat titles and workspace names, not message contents"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
            }
            if (event.key === "Enter" && searching && results.length === 1) {
              event.preventDefault();
              void open(results[0].id);
            }
            if (event.key === "ArrowUp" && searching) {
              event.preventDefault();
              document
                .querySelector<HTMLButtonElement>(
                  ".sidebar-search-results .session-list > button",
                )
                ?.focus();
            }
          }}
        />
        {query && (
          <button
            aria-label="Clear chat search"
            title="Clear search (Esc)"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </>
  );
}
