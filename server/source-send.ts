import { sourceSendConflict, type SendBlock } from "../shared/source-send.ts";

/** No queue: reserve the source workspace while a send is entering its runtime. */
export class SourceSendGuard {
  private starting: string | null = null;
  constructor(
    private activeSessions: () => string[],
    private otherWork: () => boolean,
  ) {}
  get isStarting() {
    return this.starting !== null;
  }
  block(): SendBlock | null {
    const sessionId = this.starting ?? this.activeSessions()[0];
    return sessionId || this.otherWork()
      ? { reason: sourceSendConflict, ...(sessionId ? { sessionId } : {}) }
      : null;
  }
  async run<T>(sessionId: string, send: () => Promise<T>): Promise<T> {
    const block = this.block();
    if (block) throw new Error(block.reason);
    // Reserve synchronously: two tabs may both pass their last UI status check.
    this.starting = sessionId;
    try {
      return await send();
    } finally {
      this.starting = null;
    }
  }
}
