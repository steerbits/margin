import { randomUUID } from "node:crypto";
import type { Store } from "./store.ts";
import type { PendingInput } from "./recovery.ts";
import type { RuntimeRecovery } from "./runtime-owner.ts";

export interface RecoverableRun {
  version: 1;
  id: string;
  generation: string;
  active: boolean;
  attempts: number;
  tools: string[];
  dialog: boolean;
  background: boolean;
}
/** Durable intent, not a replay queue. A missing tool result is never assumed
 * to mean the tool did nothing. Only new human sends reset the retry budget.
 */
export class RunRecovery {
  private state?: RecoverableRun;
  readonly generation: string;
  constructor(
    private store: Store,
    private id: string,
    private runtime?: RuntimeRecovery,
  ) {
    this.state = store.get<RecoverableRun>("run-recovery", id);
    this.generation = runtime?.generation ?? randomUUID();
  }
  private save() {
    this.store.put("run-recovery", this.id, this.state);
  }
  begin(id: string) {
    this.state = {
      version: 1,
      id,
      generation: this.generation,
      active: true,
      attempts: 0,
      tools: [],
      dialog: false,
      background: false,
    };
    this.save();
  }
  get active() {
    return this.state?.generation === this.generation && this.state.active;
  }
  toolStarted(id: string) {
    if (!this.active) return;
    this.state!.tools = [...new Set([...this.state!.tools, id])];
    this.save();
  }
  toolPersisted(id: string) {
    if (!this.active) return;
    this.state!.tools = this.state!.tools.filter((tool) => tool !== id);
    this.save();
  }
  waiting(dialog: boolean, background: boolean) {
    if (
      !this.active ||
      (this.state!.dialog === dialog && this.state!.background === background)
    )
      return;
    Object.assign(this.state!, { dialog, background });
    this.save();
  }
  cancel() {
    // Explicit user Stop also cancels a prior generation while it is loading.
    if (!this.state) return;
    this.state.active = false;
    this.save();
  }
  finish() {
    if (!this.active) return;
    this.state!.active = false;
    this.save();
  }
  prepare(
    pending: PendingInput | undefined,
    entryExists: (id: string) => boolean,
    savedTools: Set<string>,
  ): { resume: boolean; reason: string } {
    const run = this.state,
      previous = this.runtime?.previous;
    const no = (reason: string) => ({ resume: false, reason });
    if (!run || run.version !== 1 || !run.active)
      return no("Saved work is available; continue when ready.");
    if (!previous?.unexpected || previous.generation !== run.generation)
      return no(
        "Automatic continuation is disabled for a requested restart or unverified prior runtime.",
      );
    if (run.attempts >= 1)
      return no(
        "Automatic continuation already ran once. Please review before continuing again.",
      );
    if (run.dialog)
      return no(
        "A question was waiting for your answer. Pending tool interactions cannot resume after a server restart; please continue manually.",
      );
    if (run.background)
      return no(
        "Background or plugin work was interrupted. Please review its effects before continuing.",
      );
    if (run.tools.some((tool) => !savedTools.has(tool)))
      return no(
        "A tool was interrupted and its effects are uncertain. Please inspect the workspace before continuing; the tool has not been replayed.",
      );
    if (
      !pending?.persistedUserId ||
      pending.batchId !== run.id ||
      !entryExists(pending.persistedUserId)
    )
      return no(
        "The last input was not confirmed saved. Your draft is available; please send it again.",
      );
    run.generation = this.generation;
    run.attempts++;
    run.tools = [];
    // Reserve durably before the prompt or any async step. A second crash,
    // tab reconnect, or failed startup must not reset this budget.
    this.save();
    return { resume: true, reason: previous.reason };
  }
}
export const recoveryPrompt =
  "The Margin runtime was unexpectedly interrupted and has been replaced. Continue the previously requested task from the saved conversation and current workspace state. Check existing results before doing work again; do not blindly repeat commands or external actions. This is automatic recovery, not a new task or permission to expand scope.";
