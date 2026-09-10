import type { Anchor } from "../shared/types.ts";
export function anchorFromRange(
  root: HTMLElement,
  range: Range,
  messageId: string,
): Anchor | null {
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer) ||
    range.collapsed
  )
    return null;
  const prefix = range.cloneRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length,
    quote = range.toString(),
    end = start + quote.length,
    text = root.textContent ?? "";
  if (!quote.trim() || text.slice(start, end) !== quote) return null;
  return {
    messageId,
    start,
    end,
    quote,
    prefix: text.slice(Math.max(0, start - 48), start),
    suffix: text.slice(end, end + 48),
  };
}
export function resolveAnchor(
  text: string,
  anchor: Anchor,
): { start: number; end: number } | null {
  if (text.slice(anchor.start, anchor.end) === anchor.quote)
    return { start: anchor.start, end: anchor.end };
  const candidates: number[] = [];
  let at = text.indexOf(anchor.quote);
  while (at !== -1) {
    if (
      (!anchor.prefix ||
        text.slice(Math.max(0, at - anchor.prefix.length), at) ===
          anchor.prefix) &&
      (!anchor.suffix ||
        text.slice(
          at + anchor.quote.length,
          at + anchor.quote.length + anchor.suffix.length,
        ) === anchor.suffix)
    )
      candidates.push(at);
    at = text.indexOf(anchor.quote, at + 1);
  }
  return candidates.length === 1
    ? { start: candidates[0], end: candidates[0] + anchor.quote.length }
    : null;
}
export function rangeForAnchor(
  root: HTMLElement,
  anchor: Anchor,
): Range | null {
  const pos = resolveAnchor(root.textContent ?? "", anchor);
  if (!pos) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let at = 0,
    node: Node | null,
    start: Node | null = null,
    end: Node | null = null,
    so = 0,
    eo = 0;
  while ((node = walker.nextNode())) {
    const length = node.textContent?.length ?? 0;
    if (!start && pos.start >= at && pos.start < at + length) {
      start = node;
      so = pos.start - at;
    }
    if (pos.end > at && pos.end <= at + length) {
      end = node;
      eo = pos.end - at;
      break;
    }
    at += length;
  }
  if (!start || !end) return null;
  const range = document.createRange();
  range.setStart(start, so);
  range.setEnd(end, eo);
  return range;
}
