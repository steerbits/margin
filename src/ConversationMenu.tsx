import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import type { SessionInfo } from "../shared/types.ts";

export function ConversationMenu({
  session,
  x,
  y,
  active,
  onDelete,
  onStop,
  onClose,
}: {
  session: SessionInfo;
  x: number;
  y: number;
  active: boolean;
  onDelete: () => void;
  onStop: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const menu = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
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
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 228)),
        top: Math.max(8, Math.min(y, window.innerHeight - (active ? 100 : 58))),
      }}
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
