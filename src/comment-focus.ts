import type { Anchor } from "../shared/types.ts";
import { rangeForAnchor } from "./anchors.ts";

function selectedRange(container: HTMLElement, anchor: Anchor) {
  const root = container.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(anchor.messageId)}"]`,
  );
  return root && rangeForAnchor(root, anchor);
}

/** Preserve the actual selected passage when opening the rail reflows the thread. */
export function captureCommentPosition(
  container: HTMLElement | null,
  anchor: Anchor,
) {
  if (!container) return () => {};
  const range = selectedRange(container, anchor);
  const rect = range?.getBoundingClientRect();
  const viewport = container.getBoundingClientRect();
  const offset = rect ? rect.top - viewport.top : 0;
  const wasVisible =
    rect && rect.bottom > viewport.top && rect.top < viewport.bottom;
  const scrollTop = container.scrollTop;
  return () => {
    if (!container.isConnected) return;
    const current = selectedRange(container, anchor)?.getBoundingClientRect();
    if (wasVisible && current)
      container.scrollTop +=
        current.top - container.getBoundingClientRect().top - offset;
    else container.scrollTop = scrollTop;
  };
}

/** Call after card positioning; native autofocus would scroll to its provisional position. */
export function focusCommentEditor(
  container: HTMLElement,
  editor: HTMLTextAreaElement,
) {
  editor.focus({ preventScroll: true });
  const viewport = container.getBoundingClientRect();
  const card = editor.closest<HTMLElement>(".comment-card");
  const cardRect = card?.getBoundingClientRect();
  const target =
    cardRect && cardRect.height <= container.clientHeight - 32
      ? cardRect
      : editor.getBoundingClientRect();
  if (target.bottom > viewport.bottom - 16)
    container.scrollTop += target.bottom - viewport.bottom + 16;
  else if (target.top < viewport.top + 16)
    container.scrollTop += target.top - viewport.top - 16;
}
