import type { ServerPlugin } from "../../../server/plugin-api.ts";
import type { AgentBackend, BackendHost } from "../../../server/backend-api.ts";
import type {
  Comment,
  FeedbackBatch,
  SessionInfo,
  Snapshot,
} from "../../../shared/types.ts";
import { formatFeedback } from "../../../server/feedback.ts";

class FixtureBackend implements AgentBackend {
  ready = Promise.resolve();
  private listeners = new Set<(s: Snapshot) => void>();
  private state: Snapshot;
  constructor(
    public info: SessionInfo,
    host: BackendHost,
  ) {
    this.state = {
      session: info,
      messages: [
        {
          id: "virtual-reply",
          role: "assistant",
          text: "## Another runtime\n\nA second backend can use the same inline comments.",
        },
      ],
      comments: [],
      composer: "",
      busy: false,
      dialogs: [],
      notices: [],
      statuses: {},
      widgets: {},
      skills: [],
      pluginState: {},
    };
    host.store.put("session", info.id, info);
  }
  snapshot() {
    return this.state;
  }
  private emit() {
    for (const listener of this.listeners) listener(this.state);
  }
  onSnapshot(listener: (s: Snapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async send(batch: FeedbackBatch) {
    const text = formatFeedback(
      batch,
      this.state.comments,
      this.state.messages,
    );
    this.state.messages.push(
      { id: crypto.randomUUID(), role: "user", text },
      {
        id: crypto.randomUUID(),
        role: "assistant",
        text: "Feedback received by the alternate runtime.",
      },
    );
    this.state.comments = this.state.comments.map((c) =>
      batch.commentIds.includes(c.id)
        ? { ...c, status: "sent", batchId: batch.id }
        : c,
    );
    this.state.composer = "";
    this.emit();
    return { status: "accepted" };
  }
  async stop() {}
  async reload() {}
  async setModel() {}
  async dispose() {
    this.listeners.clear();
  }
  saveComments(comments: Comment[]) {
    this.state.comments = comments;
    this.emit();
  }
  setComposer(text: string) {
    this.state.composer = text;
  }
  answerDialog() {
    throw new Error("No active dialog.");
  }
  dismissNotice() {}
  notifyError() {}
  async pluginAction() {
    return {};
  }
}
const plugin: ServerPlugin = {
  id: "lab",
  apiVersion: 1,
  backends: [
    {
      id: "lab-virtual",
      label: "Compatibility fixture",
      models: async () => [
        {
          id: "fixture",
          provider: "fixture",
          name: "Compatibility fixture",
          subscription: false,
        },
      ],
      create: (info, _project, host) => new FixtureBackend(info, host),
    },
  ],
  onEvent: (e, ctx) => {
    if (e.type === "session.ready")
      ctx.publish({ note: ctx.storage.get<string>("note") ?? "", events: 0 });
  },
  action: async (name, input, ctx) => {
    if (name === "save") {
      const text = (input as { text: string }).text;
      ctx.storage.set("note", text);
      ctx.publish({ note: text });
      return { saved: true };
    }
    if (name === "load") {
      ctx.publish({ note: ctx.storage.get("note") ?? "" });
      return {};
    }
    if (name === "invalid") {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      ctx.publish(cyclic);
      return {};
    }
    if (name === "background") {
      const child = await ctx.createAgent(
        input as { provider: string; model: string },
      );
      let subscribed = false;
      const unsubscribe = child.subscribe(() => {
        subscribed = true;
      });
      await child.stop();
      unsubscribe();
      await child.dispose();
      return { created: true, disposed: true, subscribed };
    }
    throw new Error("Unknown lab action.");
  },
};
export default plugin;
