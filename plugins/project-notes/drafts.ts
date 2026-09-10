import { actionResult, type Note } from "./model.ts";

type Action = (name: string, input: unknown) => Promise<unknown>;
export interface DraftState {
  text: string;
  base?: Note;
  conflict?: Note;
  loading: boolean;
  saving: boolean;
  error?: string;
}
export const isDirty = (state: DraftState) =>
  state.base !== undefined && state.text !== state.base.text;

// Independent of the panel lifetime: closing it or switching sessions must not
// drop edits, including edits made while a save response is in flight.
export class NotesDraft {
  private state: DraftState = { text: "", loading: false, saving: false };
  private listeners = new Set<() => void>();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<DraftState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  edit(text: string) {
    this.update({ text });
  }
  async refresh(action: Action) {
    if (this.state.loading || this.state.saving) return;
    this.update({ loading: true, error: undefined });
    try {
      const { note } = actionResult(await action("load", {}));
      if (!isDirty(this.state) || this.state.text === note.text) {
        this.update({ base: note, text: note.text, conflict: undefined });
      } else {
        this.update({
          conflict:
            note.revision === this.state.base?.revision ? undefined : note,
        });
      }
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.update({ loading: false });
    }
  }
  async save(action: Action) {
    const { base, text, loading, saving, conflict } = this.state;
    if (!base || loading || saving || conflict || !isDirty(this.state)) return;
    this.update({ saving: true, error: undefined });
    try {
      const result = actionResult(
        await action("save", { text, revision: base.revision }),
      );
      if (result.saved === undefined)
        throw new Error("Invalid project-notes save response.");
      if (result.saved) {
        // Never replace text: the user may have typed more since clicking Save.
        this.update({ base: result.note, conflict: undefined });
      } else {
        this.update({ conflict: result.note });
      }
    } catch (error) {
      this.update({
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.update({ saving: false });
    }
  }
  resolveConflict(keepDraft: boolean) {
    if (!this.state.conflict) return;
    const base = this.state.conflict;
    this.update({
      base,
      text: keepDraft ? this.state.text : base.text,
      conflict: undefined,
      error: undefined,
    });
  }
}

export class ProjectDrafts {
  private drafts = new Map<string, NotesDraft>();
  get(projectId: string) {
    let draft = this.drafts.get(projectId);
    if (!draft) {
      draft = new NotesDraft();
      this.drafts.set(projectId, draft);
    }
    return draft;
  }
  hasUnsaved() {
    return [...this.drafts.values()].some((draft) => {
      const state = draft.getSnapshot();
      return isDirty(state) || state.saving || !!state.conflict;
    });
  }
}
