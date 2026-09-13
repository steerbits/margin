import type { Snapshot } from "../shared/types.ts";

/** Keep recently viewed histories in memory; drafts have an independent lifetime. */
export class ChatCache {
  private snapshots = new Map<string, Snapshot>();
  constructor(private limit = 24) {}
  get(id: string) {
    return this.snapshots.get(id);
  }
  put(snapshot: Snapshot) {
    this.snapshots.delete(snapshot.session.id);
    this.snapshots.set(snapshot.session.id, snapshot);
    while (this.snapshots.size > this.limit)
      this.snapshots.delete(this.snapshots.keys().next().value!);
  }
  delete(id: string) {
    this.snapshots.delete(id);
  }
}

export interface PendingDraft {
  text: string;
  version: number;
}
export class ChatDrafts {
  private drafts = new Map<string, PendingDraft>();
  private saves = new Map<
    string,
    { version: number; request: Promise<void> }
  >();
  private version = 0;
  private acknowledged = new Map<string, { text: string; revision: number }>();
  constructor(
    private persist: (id: string, text: string) => Promise<unknown>,
  ) {}
  get(id: string) {
    return this.drafts.get(id);
  }
  text(id: string, serverText: string, revision = 0) {
    const pending = this.drafts.get(id);
    if (pending) return pending.text;
    const saved = this.acknowledged.get(id);
    if (saved && revision < saved.revision) return saved.text;
    return serverText;
  }
  set(id: string, text: string) {
    const draft = { text, version: ++this.version };
    this.drafts.set(id, draft);
    return draft;
  }
  get unsaved() {
    return this.drafts.size > 0;
  }
  async flush(id: string): Promise<void> {
    const draft = this.drafts.get(id);
    const pending = this.saves.get(id);
    if (!draft) return pending?.request;
    if (pending?.version === draft.version) return pending.request;
    const request = (pending?.request ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const result = (await this.persist(id, draft.text)) as
          | { composerRevision?: number }
          | undefined;
        if (typeof result?.composerRevision === "number")
          this.acknowledged.set(id, {
            text: draft.text,
            revision: result.composerRevision,
          });
        if (this.drafts.get(id) === draft) this.drafts.delete(id);
      });
    this.saves.set(id, { version: draft.version, request });
    try {
      await request;
    } finally {
      if (this.saves.get(id)?.request === request) this.saves.delete(id);
    }
  }
  delete(id: string) {
    this.drafts.delete(id);
    this.acknowledged.delete(id);
  }
}
