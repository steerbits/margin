import type { Comment } from "../shared/types.ts";
export interface PendingInput {
  prompt: string;
  batchId: string;
  note: string;
  accepted: boolean;
  persistedUserId?: string;
  attachmentIds?: string[];
}
export function recoverInput(
  pending: PendingInput | undefined,
  entryExists: (id: string) => boolean,
  composer: string,
  comments: Comment[],
) {
  if (
    !pending ||
    (pending.persistedUserId && entryExists(pending.persistedUserId))
  )
    return { composer, comments, recovered: false };
  const note = pending.note;
  return {
    composer:
      composer === note || !composer
        ? note
        : !note
          ? composer
          : `${note}\n\nAdditional unsent draft:\n${composer}`,
    comments: comments.map((c) =>
      c.batchId === pending.batchId
        ? { ...c, status: "draft" as const, batchId: undefined }
        : c,
    ),
    recovered: true,
  };
}
