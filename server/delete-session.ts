import { existsSync, realpathSync, lstatSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionInfo } from "../shared/types.ts";
import { withinPath } from "./execution.ts";
import type { Store } from "./store.ts";
import { AttachmentStore } from "./attachments.ts";

export function deleteSavedSession(
  store: Store,
  info: SessionInfo,
  dataDir: string,
) {
  if (info.sessionFile && existsSync(info.sessionFile)) {
    const file = resolve(info.sessionFile);
    const root = realpathSync(join(dataDir, "pi-sessions", info.projectId));
    if (!withinPath(realpathSync(file), root) || lstatSync(file).isSymbolicLink())
      throw new Error(
        "This chat's session file is outside Margin's session storage.",
      );
    unlinkSync(file);
  }
  const attachments = new AttachmentStore(store, dataDir, info.id);
  if (attachments.list().length) attachments.deleteAll();
  store.deleteSession(info.id);
}
