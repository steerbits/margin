import type { ArtifactComment } from "../shared/artifacts.ts";

interface Pending {
  comment: ArtifactComment;
  key: string;
}
/** Per-mutation recovery records avoid last-writer-wins loss between review windows. */
export class ArtifactDrafts {
  private pending = new Map<string, Pending>();
  private confirmed = new Map<string, ArtifactComment>();
  private running?: Promise<void>;
  error = "";
  warning = "";
  private prefix: string;
  constructor(
    sessionId: string,
    private storage: Storage,
    private save: (comment: ArtifactComment) => Promise<ArtifactComment>,
    private changed: () => void,
  ) {
    this.prefix = `margin-artifact-draft:${sessionId}:`;
    try {
      for (const key of Object.keys(storage).filter((key) =>
        key.startsWith(this.prefix),
      )) {
        const comment = JSON.parse(storage.getItem(key)!);
        if (
          !comment?.id ||
          !comment?.mutationId ||
          typeof comment.text !== "string"
        )
          continue;
        if (this.pending.has(comment.id)) {
          comment.id = crypto.randomUUID();
          comment.revision = 0;
          comment.batchId = undefined;
          comment.mutationId = crypto.randomUUID();
          comment.delivery = "draft";
          this.warning =
            "Recovered multiple draft versions. Review them before sending.";
        }
        this.pending.set(comment.id, { comment, key });
      }
    } catch {
      this.error =
        "Browser draft recovery is unavailable. Keep this window open until your comments are saved.";
    }
  }
  get dirty() {
    return this.pending.size > 0;
  }
  private persist(entry: Pending) {
    try {
      this.storage.setItem(entry.key, JSON.stringify(entry.comment));
    } catch {
      this.error =
        "Local recovery storage is full or unavailable. Keep this window open until server saving succeeds.";
    }
  }
  edit(comment: ArtifactComment) {
    const previous = this.pending.get(comment.id);
    const mutationId = crypto.randomUUID();
    const entry = {
      comment: {
        ...comment,
        mutationId,
        revision:
          previous?.comment.revision ??
          this.confirmed.get(comment.id)?.revision ??
          comment.revision,
      },
      key: this.prefix + mutationId,
    };
    this.persist(entry);
    // Only remove the previous local version after the replacement was stored.
    if (previous && this.storage.getItem(entry.key))
      this.storage.removeItem(previous.key);
    this.pending.set(comment.id, entry);
    this.changed();
  }
  merge(remote: ArtifactComment[]) {
    for (const c of remote)
      if (c.revision >= (this.confirmed.get(c.id)?.revision ?? -1))
        this.confirmed.set(c.id, c);
    const comments = new Map(this.confirmed);
    for (const [id, p] of this.pending) comments.set(id, p.comment);
    return [...comments.values()].sort((a, b) => a.createdAt - b.createdAt);
  }
  async flush() {
    if (this.running) return this.running;
    this.running = this.run();
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }
  private async run() {
    while (this.pending.size) {
      const [id, entry] = this.pending.entries().next().value!;
      try {
        const saved = await this.save(entry.comment);
        this.confirmed.set(saved.id, saved);
        const current = this.pending.get(id);
        if (current === entry) this.pending.delete(id);
        else if (current) {
          current.comment.revision = saved.revision;
          this.persist(current);
        }
        this.storage.removeItem(entry.key);
        this.error = "";
      } catch (error) {
        if ((error as { conflict?: boolean }).conflict) {
          const current = this.pending.get(id) ?? entry;
          const copy = {
            ...current.comment,
            id: crypto.randomUUID(),
            revision: 0,
            mutationId: crypto.randomUUID(),
            batchId: undefined,
            delivery: "draft" as const,
          };
          this.pending.delete(id);
          const recovered = {
            comment: copy,
            key: this.prefix + copy.mutationId,
          };
          this.persist(recovered);
          this.pending.set(copy.id, recovered);
          if (this.storage.getItem(recovered.key))
            this.storage.removeItem(current.key);
          this.warning =
            "An annotation changed in another window or was sent. Your version is preserved as a separate draft.";
        } else {
          this.error = `Not saved to Margin yet: ${error instanceof Error ? error.message : String(error)}. Your draft remains here; retry before sending.`;
          this.changed();
          throw error;
        }
      }
      this.changed();
    }
  }
}
export async function saveArtifactComment(
  sessionId: string,
  comment: ArtifactComment,
): Promise<ArtifactComment> {
  const response = await fetch(
    `/api/sessions/${sessionId}/artifacts/comments`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(comment),
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? "Saving failed"), {
      conflict: response.status === 409,
    });
  return result;
}
