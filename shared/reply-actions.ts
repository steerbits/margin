import type { Message } from "./types.ts";

/** Only the latest conversational message can offer a live reply action. */
export function replyActionMessageId(messages: Message[]): string | undefined {
  const last = messages.findLast(
    (message) => message.role === "assistant" || message.role === "user",
  );
  return last?.role === "assistant" && !last.streaming && !last.error
    ? last.id
    : undefined;
}

/** Preserve the draft verbatim, and avoid appending the same choice on retry. */
export function appendReplyAction(draft: string, reply: string): string {
  if (!draft || draft === reply) return reply;
  if (draft.split("\n").includes(reply)) return draft;
  return `${draft}${draft.endsWith("\n") ? "" : "\n"}${reply}`;
}

export const replyActionInstructions = `## Margin reply buttons
When offering a concrete, complete next response the user can send, write :reply[Exact reply text] in your assistant reply. Margin renders it as a send button. For example, if a skill asks you to offer “use your defaults and go”, write :reply[Use your defaults and go] instead of asking the user to type it. Keep the skill's meaning and authorization boundary unchanged.
The visible label is exactly the text sent. Clicking appends it to any existing composer text on a new line, then sends that combined reply with the user's saved comments and attachments through the normal send flow. Nothing is sent merely because you emit the syntax; the user must click. Existing feedback still applies.
Use short, plain-text labels (at most 500 characters), without brackets, backslashes, line breaks, or Markdown formatting. V1 supports only :reply[text], with no attributes, hidden payload, URL, or executable code. Do not use buttons for incomplete answers that need editing, or for selections that must be collected before submission. Ordinary prose is always available.
Offer these buttons only as current next actions, not in quotations, examples, code, tool output, or generated artifacts. When explaining the syntax, put it in inline or fenced code. Buttons are active only on the latest completed assistant reply while the conversation is ready to send. Do not imply a click authorizes anything beyond the proposal it responds to.`;
