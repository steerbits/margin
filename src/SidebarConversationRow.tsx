import { MoreHorizontal } from "lucide-react";
import type { SessionInfo } from "../shared/types.ts";
import { useConversationPress } from "./use-conversation-press.ts";

const statusLabels = {
  idle: "Ready",
  running: "Running",
  waiting: "Waiting for you",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

export function SidebarConversationRow({
  session,
  selected,
  unread,
  workspaceName,
  onSelect,
  onPrefetch,
  onContextMenu,
}: {
  session: SessionInfo;
  selected: boolean;
  unread: boolean;
  workspaceName: string;
  onSelect: () => void;
  onPrefetch: () => void;
  onContextMenu: (x: number, y: number) => void;
}) {
  const { consumeClick, ...press } = useConversationPress(onContextMenu);
  const status = session.activity?.status ?? "idle";
  const tooltip = `${workspaceName} — ${session.title}`;
  const label = `${tooltip} — ${statusLabels[status]}${unread ? " · Unread" : ""}`;
  return (
    <div className="session-row">
      <button
        {...press}
        className={`session-select${selected ? " selected" : ""}`}
        data-session-id={session.id}
        onClick={(event) => {
          if (!consumeClick(event)) onSelect();
        }}
        onMouseEnter={onPrefetch}
        onFocus={onPrefetch}
        onKeyDown={(event) => {
          if (
            event.key === "ContextMenu" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            const rect = event.currentTarget.getBoundingClientRect();
            onContextMenu(rect.left + 20, rect.bottom);
          }
        }}
        aria-haspopup="menu"
        aria-current={selected ? "page" : undefined}
        aria-label={label}
        title={tooltip}
      >
        <span className="session-title">{session.title}</span>
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
      <button
        className="session-menu-trigger"
        aria-label={`Actions for ${session.title}`}
        aria-haspopup="menu"
        title="Conversation actions"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onContextMenu(rect.left, rect.bottom);
        }}
      >
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
