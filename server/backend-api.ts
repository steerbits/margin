import type {
  Comment,
  FeedbackBatch,
  ModelInfo,
  Project,
  SessionInfo,
  Snapshot,
} from "../shared/types.ts";
import type { Store } from "./store.ts";
import type { ServerPlugin } from "./plugin-api.ts";

/** A runtime implements this boundary; HTTP handlers and the browser consume only this API. */
export interface AgentBackend {
  info: SessionInfo;
  ready: Promise<void>;
  snapshot(): Snapshot;
  onSnapshot(listener: (snapshot: Snapshot) => void): () => void;
  send(batch: FeedbackBatch): Promise<{ status: string }>;
  stop(): Promise<void>;
  reload(): Promise<void>;
  setModel(provider: string, id: string): Promise<void>;
  setThinking?(level: string): Promise<void>;
  saveComments(comments: Comment[]): void;
  setComposer(text: string): void;
  /** Optional capability: the runtime resolves attachment IDs when sending. */
  attachmentsChanged?(): void;
  answerDialog(id: string, value: unknown, cancelled?: boolean): void;
  dismissNotice(id: string): void;
  notifyError(error: unknown): void;
  pluginAction(
    pluginId: string,
    action: string,
    input: unknown,
  ): Promise<unknown>;
  dispose(): Promise<void>;
  hasActiveWork?(): boolean;
}
export interface BackendHost {
  store: Store;
  dataDir: string;
  appRoot: string;
  plugins: ServerPlugin[];
}
export interface BackendDefinition {
  id: string;
  label: string;
  models(host: BackendHost): Promise<ModelInfo[]>;
  create(info: SessionInfo, project: Project, host: BackendHost): AgentBackend;
}
export function backendRegistry(definitions: BackendDefinition[]) {
  const registry = new Map<string, BackendDefinition>();
  for (const d of definitions) {
    if (!/^[a-z][a-z0-9-]*$/.test(d.id) || registry.has(d.id))
      throw new Error(`Invalid or duplicate backend ${d.id}`);
    registry.set(d.id, d);
  }
  return registry;
}
