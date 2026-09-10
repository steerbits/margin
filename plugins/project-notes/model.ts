export const MAX_NOTE_LENGTH = 100_000;

export interface Note {
  text: string;
  revision: number;
}
export type SaveResult = { saved: boolean; note: Note };

export function isNote(value: unknown): value is Note {
  if (!value || typeof value !== "object") return false;
  const note = value as Note;
  return (
    typeof note.text === "string" &&
    note.text.length <= MAX_NOTE_LENGTH &&
    Number.isSafeInteger(note.revision) &&
    note.revision >= 0
  );
}

// BrowserPluginContext.action returns the host's { result } response envelope.
export function actionResult(value: unknown): { note: Note; saved?: boolean } {
  const result = (
    value as { result?: { note?: unknown; saved?: unknown } } | null
  )?.result;
  if (
    !result ||
    !isNote(result.note) ||
    (result.saved !== undefined && typeof result.saved !== "boolean")
  )
    throw new Error(
      "Invalid project-notes response. Reload the app after installing the plugin.",
    );
  return result as { note: Note; saved?: boolean };
}
