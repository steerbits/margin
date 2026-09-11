import {
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type UIEventHandler,
} from "react";
import { X } from "lucide-react";
import "./PluginPanel.css";

export function ConversationWorkspace({
  children,
  panel,
  scrollRef,
  onScroll,
}: {
  children: ReactNode;
  panel: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
}) {
  return (
    <div className="conversation-workspace">
      <div className="scroll-area" ref={scrollRef} onScroll={onScroll}>
        {children}
      </div>
      {panel}
    </div>
  );
}

// Resizing the thread to make room for a panel must not send a reader elsewhere.
// Keep the bottom pinned, or preserve the first visible block and its offset.
export function captureConversationPosition(container: HTMLElement | null) {
  if (!container) return () => {};
  const top = container.getBoundingClientRect().top;
  const scrollTop = container.scrollTop;
  const atBottom =
    container.scrollHeight - scrollTop - container.clientHeight < 2;
  const anchor = [
    ...container.querySelectorAll<HTMLElement>(
      ".message h1, .message h2, .message h3, .message p, .message pre, .message tr, .message li, .composer",
    ),
  ].find((element) => element.getBoundingClientRect().bottom > top);
  const offset = anchor ? anchor.getBoundingClientRect().top - top : 0;
  return () => {
    if (!container.isConnected) return;
    if (atBottom) container.scrollTop = container.scrollHeight;
    else if (anchor?.isConnected)
      container.scrollTop +=
        anchor.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        offset;
    else container.scrollTop = scrollTop;
  };
}

export function PluginPanel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current!;
    const narrow = window.matchMedia("(max-width: 900px)");
    const updateMode = () => {
      const focused = dialog.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;
      if (dialog.open) dialog.close();
      if (narrow.matches) {
        dialog.setAttribute("aria-modal", "true");
        dialog.showModal();
      } else {
        dialog.removeAttribute("aria-modal");
        dialog.show();
      }
      focused?.focus({ preventScroll: true });
    };
    updateMode();
    narrow.addEventListener("change", updateMode);
    return () => {
      narrow.removeEventListener("change", updateMode);
      dialog.close();
    };
  }, []);

  return (
    <dialog
      id="plugin-panel"
      className="plugin-panel"
      aria-label={title}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
      onClick={(event) => {
        if (
          event.target !== event.currentTarget ||
          !event.currentTarget.matches(":modal")
        )
          return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      <div className="plugin-panel-heading">
        <strong>{title}</strong>
        <button aria-label="Close panel" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      <div className="plugin-panel-content">{children}</div>
    </dialog>
  );
}
