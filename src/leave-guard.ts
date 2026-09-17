import type { AppRoute } from "../shared/navigation.ts";

/** Panel-only navigation keeps the same editor mounted, so it cannot lose edits. */
export function sameInstructionsSurface(a: AppRoute, b: AppRoute) {
  if (a.kind === "workspace" && b.kind === "workspace")
    return a.projectId === b.projectId && a.view !== "new" && b.view !== "new";
  return (
    a.kind === "customize" &&
    b.kind === "customize" &&
    a.tab === "instructions" &&
    b.tab === "instructions"
  );
}

/** One mounted instruction editor owns the app's manual-save exit boundary. */
export class LeaveGuard {
  private entry?: { owner: symbol; confirm: () => Promise<boolean> };
  get blocking() {
    return !!this.entry;
  }
  register(owner: symbol, confirm: () => Promise<boolean>) {
    this.entry = { owner, confirm };
    return () => this.release(owner);
  }
  release(owner: symbol) {
    if (this.entry?.owner === owner) this.entry = undefined;
  }
  confirmLeave(): Promise<boolean> {
    return this.entry?.confirm() ?? Promise.resolve(true);
  }
}
