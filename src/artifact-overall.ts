import type { ArtifactOverall } from "../shared/artifacts.ts";

interface Recovery {
  key: string;
  value: ArtifactOverall;
  at: number;
}
/** Overall feedback is separate from the chat composer and uses its own recovery journal. */
export class OverallFeedbackDraft {
  private remote: ArtifactOverall = { text: "", revision: 0, mutationId: "" };
  private pending?: Recovery;
  private running?: Promise<void>;
  readonly recovered: Recovery[] = [];
  error = "";
  conflict = false;
  private prefix: string;
  constructor(
    sessionId: string,
    private storage: Storage,
    private save: (value: ArtifactOverall) => Promise<ArtifactOverall>,
    private changed: () => void,
  ) {
    this.prefix = `margin-artifact-overall:${sessionId}:`;
    try {
      const entries = Object.keys(storage)
        .filter((key) => key.startsWith(this.prefix))
        .flatMap((key) => {
          try {
            const item = JSON.parse(storage.getItem(key)!);
            return typeof item.value?.text === "string"
              ? [{ ...item, key } as Recovery]
              : [];
          } catch {
            return [];
          }
        })
        .sort((a, b) => b.at - a.at);
      this.pending = entries[0];
      this.recovered.push(...entries.slice(1));
    } catch {
      this.error =
        "Browser recovery storage is unavailable. Keep this window open until feedback saves.";
    }
  }
  get text() {
    return this.pending?.value.text ?? this.remote.text;
  }
  get revision() {
    return this.remote.revision;
  }
  get dirty() {
    return !!this.pending;
  }
  get otherText() {
    return this.remote.text;
  }
  observe(value?: ArtifactOverall) {
    if (value && value.revision >= this.remote.revision) this.remote = value;
  }
  private persist(item: Recovery) {
    try {
      this.storage.setItem(item.key, JSON.stringify(item));
      return true;
    } catch {
      this.error =
        "Local recovery is unavailable. Keep this window open until server saving succeeds.";
      return false;
    }
  }
  edit(text: string) {
    const previous = this.pending;
    const mutationId = crypto.randomUUID();
    this.pending = {
      key: this.prefix + mutationId,
      value: {
        text,
        revision: previous?.value.revision ?? this.remote.revision,
        mutationId,
      },
      at: Date.now(),
    };
    if (this.persist(this.pending) && previous)
      this.storage.removeItem(previous.key);
    this.changed();
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
    if (this.conflict)
      throw new Error("Choose which overall feedback to keep before sending.");
    while (this.pending) {
      const entry = this.pending;
      try {
        const saved = await this.save(entry.value);
        this.observe(saved);
        if (this.pending === entry) this.pending = undefined;
        else {
          this.pending.value.revision = saved.revision;
          this.persist(this.pending);
        }
        this.storage.removeItem(entry.key);
        this.error = "";
      } catch (e) {
        this.conflict = !!(e as { conflict?: boolean }).conflict;
        this.error = this.conflict
          ? "Overall feedback changed in another window. Both versions are retained; choose which to keep."
          : `Overall feedback is not saved to Margin yet: ${(e as Error).message}. Your text remains here.`;
        this.changed();
        throw e;
      }
      this.changed();
    }
  }
  keepMine() {
    if (this.pending) {
      this.pending.value.revision = this.remote.revision;
      this.pending.value.mutationId = crypto.randomUUID();
      this.persist(this.pending);
    }
    this.conflict = false;
    this.error = "";
    this.changed();
  }
  useOther() {
    if (this.pending) this.storage.removeItem(this.pending.key);
    this.pending = undefined;
    this.conflict = false;
    this.error = "";
    this.changed();
  }
  restore(item: Recovery) {
    // Explicitly append, rather than replacing the currently visible text.
    this.edit([this.text, item.value.text].filter(Boolean).join("\n\n"));
    this.removeRecovery(item);
  }
  removeRecovery(item: Recovery) {
    this.storage.removeItem(item.key);
    this.recovered.splice(this.recovered.indexOf(item), 1);
    this.changed();
  }
}
export async function saveOverallFeedback(
  sessionId: string,
  value: ArtifactOverall,
): Promise<ArtifactOverall> {
  const response = await fetch(`/api/sessions/${sessionId}/artifacts/overall`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const result = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(result.error ?? "Saving failed"), {
      conflict: response.status === 409,
    });
  return result;
}
