import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "../shared/types.ts";

export function ConversationMenu({
  session,
  x,
  y,
  active,
  unread,
  onToggleRead,
  onDelete,
  onStop,
  onClose,
}: {
  session: SessionInfo;
  x: number;
  y: number;
  active: boolean;
  unread: boolean;
  onToggleRead: () => void;
  onDelete: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current!;
    // Measure rather than guessing: touch targets and running chats add height.
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
  }, [x, y, active, unread]);
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    menu
      .querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) close.current();
    };
    const dismiss = () => close.current();
    const scroll = (event: Event) => {
      if (
        event.target === document ||
        (event.target as Element).matches?.(".session-list")
      )
        dismiss();
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    document.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", scroll, true);
      if (menu.contains(document.activeElement))
        previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${session.title}`}
      className="conversation-menu"
      style={{ left: x, top: y }}
      onKeyDown={(event) => {
        if (event.key === "Escape" || event.key === "Tab") {
          if (event.key === "Escape") event.preventDefault();
          onClose();
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(
            ref.current!.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? items.length - 1
                : (index +
                    (event.key === "ArrowDown" ? 1 : -1) +
                    items.length) %
                  items.length;
          items[next]?.focus();
        }
      }}
    >
      <button role="menuitem" onClick={onToggleRead}>
        {unread ? "Mark as read" : "Mark unread"}
      </button>
      {active && (
        <button role="menuitem" onClick={onStop}>
          Stop conversation
        </button>
      )}
      <button
        role="menuitem"
        className="delete-menu-item"
        disabled={active}
        title={active ? "Stop this conversation before deleting it" : undefined}
        onClick={onDelete}
      >
        Delete conversation
      </button>
    </div>,
    document.body,
  );
}
