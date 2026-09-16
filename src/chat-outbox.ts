import type {
  Attachment,
  FeedbackBatch,
  Message,
  Snapshot,
} from "../shared/types.ts";
import { formatFeedback } from "../shared/feedback.ts";

export interface OutgoingMessage {
  id: string;
  sessionId: string;
  note: string;
  nextDraft?: string;
  message: Message;
  previousUserIds: Set<string>;
  status: "sending" | "accepted";
}

/** Presentation-only messages. The original draft remains saved until acceptance. */
export class ChatOutbox {
  private pending = new Map<string, OutgoingMessage>();

  get(id: string | null) {
    return id ? this.pending.get(id) : undefined;
  }
  begin(snapshot: Snapshot, batch: FeedbackBatch, attachments: Attachment[]) {
    const message: Message = {
      id: `outgoing:${batch.id}`,
      role: "user",
      text:
        batch.note.trim() || batch.commentIds.length
          ? formatFeedback(batch, snapshot.comments, snapshot.messages)
          : "",
      skill: batch.skill,
      attachments,
    };
    this.pending.set(snapshot.session.id, {
      id: batch.id,
      sessionId: snapshot.session.id,
      note: batch.note,
      message,
      previousUserIds: new Set(
        snapshot.messages.filter((m) => m.role === "user").map((m) => m.id),
      ),
      status: "sending",
    });
  }
  edit(id: string, text: string) {
    const pending = this.get(id);
    if (pending) pending.nextDraft = text;
  }
  text(id: string, fallback: string) {
    const pending = this.get(id);
    return pending ? (pending.nextDraft ?? "") : fallback;
  }
  accept(id: string, batchId: string) {
    const pending = this.get(id);
    if (pending?.id === batchId) pending.status = "accepted";
  }
  reject(id: string, batchId: string) {
    const pending = this.get(id);
    if (pending?.id !== batchId) return;
    this.pending.delete(id);
    return pending.nextDraft && pending.nextDraft !== pending.note
      ? `${pending.note}${pending.note ? "\n\n" : ""}${pending.nextDraft}`
      : pending.note;
  }
  observe(
    snapshot: Snapshot,
  ): { draft: string; rejected: boolean } | undefined {
    const pending = this.get(snapshot.session.id);
    if (!pending) return;
    const submission = snapshot.submission;
    const matches = submission?.id === pending.id;
    // A different browser may be sending too. Never acknowledge its message as ours.
    const hasMessage =
      (!submission || matches) &&
      snapshot.messages.some(
        (m) => m.role === "user" && !pending.previousUserIds.has(m.id),
      );
    // An extension command may be accepted and finish without a transcript entry.
    // Its settled outcome must also release the composer for the next message.
    if (
      hasMessage ||
      (matches && submission.status === "accepted" && !snapshot.busy)
    ) {
      this.pending.delete(snapshot.session.id);
      return {
        draft:
          pending.nextDraft ??
          (snapshot.composer === pending.note ? "" : snapshot.composer),
        rejected: false,
      };
    }
    if (matches && submission.status === "rejected")
      return {
        draft: this.reject(snapshot.session.id, pending.id)!,
        rejected: true,
      };
    if (matches && submission.status === "accepted")
      this.accept(snapshot.session.id, pending.id);
  }
}
