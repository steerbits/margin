import { randomUUID } from "node:crypto";
import type { SessionActivity, Snapshot } from "../shared/types.ts";

/** Tracks public chat outcomes independently of a backend's mutable session record. */
export class SessionActivityTracker {
  private replyId?: string;
  private errors = new Set<string>();
  private stopped = false;
  private initialized = false;
  private pendingError = false;
  private settledStatus: SessionActivity["status"];
  constructor(public activity: SessionActivity = { status: "idle" }) {
    this.settledStatus = ["running", "waiting"].includes(activity.status)
      ? "stopped"
      : activity.status;
  }
  stop() {
    this.stopped = true;
  }
  update(snapshot: Snapshot): SessionActivity {
    const reply = snapshot.messages.findLast(
      (m) => m.role === "assistant" && !m.streaming,
    );
    const newError = snapshot.notices.some(
      (n) => n.level === "error" && !this.errors.has(n.id),
    );
    const newReply = this.initialized && !!reply && reply.id !== this.replyId;
    const wasActive = ["running", "waiting"].includes(this.activity.status);
    if (snapshot.busy && !wasActive) this.pendingError = false;
    if (newError) this.pendingError = true;
    let status: SessionActivity["status"] = this.activity.status;
    if (snapshot.dialogs.length) status = "waiting";
    else if (snapshot.busy) {
      status = "running";
      this.stopped = false;
    } else if (this.stopped) status = "stopped";
    else if (this.pendingError || (reply?.error && newReply)) status = "failed";
    else if (newReply) status = "finished";
    else status = this.settledStatus;
    if (!["running", "waiting"].includes(status)) this.settledStatus = status;
    const settledReply =
      !snapshot.busy && !snapshot.dialogs.length && reply && newReply;
    this.activity = {
      ...this.activity,
      status,
      ...(settledReply && !this.stopped
        ? { replyId: reply.id, completionId: randomUUID() }
        : {}),
    };
    if (!this.initialized || !snapshot.busy) this.replyId = reply?.id;
    this.errors = new Set(
      snapshot.notices.filter((n) => n.level === "error").map((n) => n.id),
    );
    this.initialized = true;
    return this.activity;
  }
}
