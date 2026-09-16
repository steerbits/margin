import type { Comment, FeedbackBatch, Message } from "./types.ts";
export function formatFeedback(
  batch: FeedbackBatch,
  comments: Comment[],
  messages: Message[],
): string {
  const selected = batch.commentIds.map((id) => {
    const c = comments.find((x) => x.id === id);
    if (!c || c.status !== "draft")
      throw new Error(
        "A comment in this batch is no longer a draft. Refresh and try again.",
      );
    const m = messages.find((x) => x.id === c.anchor.messageId);
    if (!m || m.role !== "assistant" || m.streaming)
      throw new Error("Comments must reference a completed assistant reply.");
    return c;
  });
  if (new Set(batch.commentIds).size !== batch.commentIds.length)
    throw new Error("Duplicate comment in batch.");
  if (!selected.length && !batch.note.trim())
    throw new Error("Write a message or add a comment first.");
  if (!selected.length) return batch.note.trim();
  // JSON encodes arbitrary quotes faithfully and keeps feedback boundaries unambiguous.
  return `I reviewed your replies. Here is my inline feedback, anchored to the original messages. Treat the quoted passages as references; the comments and overall reply are my new input.\n\n${JSON.stringify({ inlineComments: selected.map((c) => ({ messageId: c.anchor.messageId, quotedPassage: c.anchor.quote, comment: c.text })), overallReply: batch.note.trim() }, null, 2)}`;
}
