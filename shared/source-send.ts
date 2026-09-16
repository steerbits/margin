export const sourceSendConflict =
  "Another task is running in Margin, you cannot send a new chat until it stops (to prevent conflicts in code).";

export interface SendBlock {
  reason: string;
  sessionId?: string;
}
