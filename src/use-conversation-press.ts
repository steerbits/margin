import { useEffect, useRef, type MouseEvent, type PointerEvent } from "react";

/** Touch is an additional shortcut; context-menu and keyboard access still work. */
export function useConversationPress(onOpen: (x: number, y: number) => void) {
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  const opened = useRef(false);
  function cancel() {
    clearTimeout(timer.current);
    timer.current = undefined;
    press.current = null;
  }
  useEffect(() => {
    const multitouch = (event: globalThis.PointerEvent) => {
      if (event.pointerType === "touch" && !event.isPrimary) cancel();
    };
    document.addEventListener("scroll", cancel, true);
    document.addEventListener("pointerdown", multitouch);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      document.removeEventListener("scroll", cancel, true);
      document.removeEventListener("pointerdown", multitouch);
      window.removeEventListener("blur", cancel);
    };
  }, []);
  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      cancel();
      suppressClick.current = false;
      opened.current = false;
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      press.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      };
      timer.current = setTimeout(() => {
        const start = press.current;
        if (!start) return;
        suppressClick.current = true;
        opened.current = true;
        onOpen(start.x, start.y);
      }, 500);
    },
    onPointerMove(event: PointerEvent<HTMLButtonElement>) {
      const start = press.current;
      if (
        start &&
        start.id === event.pointerId &&
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10
      ) {
        suppressClick.current = true;
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu(event: MouseEvent<HTMLButtonElement>) {
      event.preventDefault();
      // Some browsers also emit a native contextmenu during a touch hold.
      // Handle it once and don't let releasing the finger select the chat.
      if (press.current) suppressClick.current = true;
      cancel();
      if (opened.current) return;
      opened.current = true;
      onOpen(event.clientX, event.clientY);
    },
    onMouseDown(event: MouseEvent<HTMLButtonElement>) {
      // Touch compatibility mouse events arrive after the menu has taken focus.
      if (suppressClick.current) event.preventDefault();
    },
    consumeClick(event: MouseEvent<HTMLButtonElement>) {
      if (!suppressClick.current || event.detail === 0) return false;
      event.preventDefault();
      event.stopPropagation();
      return true;
    },
  };
}
