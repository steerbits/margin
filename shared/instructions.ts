export const MAX_INSTRUCTION_BYTES = 256 * 1024;

export interface InstructionsView {
  path: string;
  exists: boolean;
  content: string;
  revision: string;
  blockedReason?: string;
  effectivePath?: string;
}

export interface InstructionsSave {
  content: string;
  revision: string;
}
