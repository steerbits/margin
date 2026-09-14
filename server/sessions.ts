import { pluginStorage } from "./plugin-storage.ts";
import { presentArtifactTool } from "./artifact-tool.ts";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { EventEmitter } from "node:events";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type {
  Comment,
  FeedbackBatch,
  Message,
  Project,
  SessionInfo,
  Snapshot,
  ToolView,
} from "../shared/types.ts";
import { Store } from "./store.ts";
import { UiBridge } from "./ui-bridge.ts";
import { createModels, modelInfo } from "./models.ts";
import { contentText, diffFrom, transcript } from "./transcript.ts";
import { formatFeedback } from "./feedback.ts";
import type {
  PluginContext,
  ServerPlugin,
  BackgroundAgent,
} from "./plugin-api.ts";
import { dispatchPluginEvent } from "./plugins.ts";
import type { AgentBackend } from "./backend-api.ts";
import { recoverInput, type PendingInput } from "./recovery.ts";

export class LiveSession implements AgentBackend {
  events = new EventEmitter();
  ui: UiBridge;
  agent!: AgentSession;
  models!: ModelRuntime;
  messages: Message[] = [];
  live?: Message;
  liveTools = new Map<string, ToolView>();
  busy = true;
  pluginState: Record<string, unknown> = {};
  ready: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private children = new Set<BackgroundAgent>();
  private childOperations = 0;
  private pluginOperations = 0;
  private disposing = false;
  private submitting?: { comments: Comment[]; note: string };
  constructor(
    public info: SessionInfo,
    public project: Project,
    private store: Store,
    private dataDir: string,
    private appRoot: string,
    private plugins: ServerPlugin[],
  ) {
    this.ui = new UiBridge(() => {
      if (this.disposing) return;
      this.store.put("composer", this.info.id, this.ui.editorText);
      this.changed();
    });
    this.ui.editorText = store.get<string>("composer", info.id) ?? "";
    this.messages = store.get<Message[]>("transcript", info.id) ?? [];
    this.ready = this.initialize();
    this.ready.catch((e) => {
      this.busy = false;
      this.ui.notify(errorText(e), "error");
      this.changed();
    });
  }
  private async initialize() {
    this.models = await createModels(this.dataDir);
    const available = await this.models.getAvailable();
    const requested = this.info.model;
    const model = requested
      ? available.find(
          (m) => m.id === requested.id && m.provider === requested.provider,
        )
      : (available.find(
          (m) => m.provider === "openai-codex" && m.id === "gpt-5.6-sol",
        ) ??
        available.find((m) => m.provider === "openai-codex") ??
        available[0]);
    if (requested && !model)
      throw new Error(
        "The selected model is unavailable. Choose another model.",
      );
    if (!model)
      throw new Error(
        "No authenticated Pi models found. In a terminal, run pi, use /login, then retry or restart Margin.",
      );
    const settings = SettingsManager.create(this.project.path, getAgentDir());
    // Adding a project explicitly selects the local workspace whose Pi resources are loaded.
    settings.setProjectTrusted(true);
    const loader = new DefaultResourceLoader({
      cwd: this.project.path,
      agentDir: getAgentDir(),
      settingsManager: settings,
      additionalSkillPaths: [join(this.appRoot, "skills")],
      appendSystemPrompt: [
        "The user is working in Margin, a browser interface for Pi. Follow the selected skill and project instructions. User feedback may include exact quoted passages and inline comments from earlier replies. Treat comments as new user input, and quotes as references. Standard extension UI dialogs are available; terminal component factories are not.",
      ],
    });
    await loader.reload();
    const interrupted = this.store.get<boolean>("interrupted", this.info.id);
    const backup = this.store.get<{ header: unknown; entries: unknown[] }>(
      "pi-backup",
      this.info.id,
    );
    if (
      this.info.sessionFile &&
      !existsSync(this.info.sessionFile) &&
      backup?.header
    ) {
      mkdirSync(dirname(this.info.sessionFile), { recursive: true });
      writeFileSync(
        this.info.sessionFile,
        [backup.header, ...backup.entries]
          .map((e) => JSON.stringify(e))
          .join("\n") + "\n",
        { flag: "wx", mode: 0o600 },
      );
    }
    const manager =
      this.info.sessionFile && existsSync(this.info.sessionFile)
        ? SessionManager.open(this.info.sessionFile)
        : SessionManager.create(
            this.project.path,
            join(this.dataDir, "pi-sessions", this.project.id),
          );
    if (interrupted) {
      const pending = this.store.get<PendingInput>(
        "pending-input",
        this.info.id,
      );
      const recovered = recoverInput(
        pending,
        (id) => !!manager.getEntry(id),
        this.ui.editorText,
        this.store.comments(this.info.id),
      );
      if (recovered.recovered) {
        this.ui.editorText = recovered.composer;
        this.store.put("composer", this.info.id, recovered.composer);
        this.store.put("comments", this.info.id, recovered.comments);
        if (pending)
          this.store.markBatch(this.info.id, pending.batchId, "rejected");
      } else if (
        pending &&
        this.store.batch(this.info.id, pending.batchId)?.status === "submitting"
      )
        this.store.markBatch(
          this.info.id,
          pending.batchId,
          pending.persistedUserId ? "accepted" : "rejected",
        );
      this.ui.notify(
        "The previous run was interrupted. Saved messages and feedback are available; continue when ready. Pending tool interactions cannot resume after a server restart.",
        "warning",
      );
    }
    const result = await createAgentSession({
      cwd: this.project.path,
      modelRuntime: this.models,
      model,
      settingsManager: settings,
      resourceLoader: loader,
      sessionManager: manager,
      customTools: [
        presentArtifactTool(this.store, this.info.id, this.project),
        ...this.plugins.flatMap(
          (p) => p.tools?.(this.pluginContext(p.id)) ?? [],
        ),
      ],
    });
    this.agent = result.session;
    this.info.sessionFile = manager.getSessionFile();
    if (this.disposing) return;
    this.info.model = modelInfo(this.models, model);
    this.persist();
    this.agent.subscribe((e) => this.onEvent(e));
    this.messages = transcript(manager.getBranch());
    if (result.modelFallbackMessage)
      this.ui.notify(result.modelFallbackMessage, "warning");
    for (const d of [
      ...loader.getSkills().diagnostics,
      ...result.extensionsResult.errors,
    ])
      this.ui.notify(typeof d === "string" ? d : JSON.stringify(d), "warning");
    // Binding can wait for a startup question. The session is already reachable in the host map.
    await this.agent.bindExtensions({
      mode: "rpc",
      uiContext: this.ui.context(),
      abortHandler: () => {
        void this.stop();
      },
      shutdownHandler: async () => {
        await this.stop();
      },
      onError: (e) => this.ui.notify(`Extension error: ${e.error}`, "error"),
      commandContextActions: {
        waitForIdle: () => this.agent.waitForIdle(),
        reload: () => this.agent.reload(),
        newSession: async () => {
          throw new Error(
            "Use New conversation in Margin to create a session.",
          );
        },
        fork: async () => {
          throw new Error(
            "Session branching is not available in this prototype.",
          );
        },
        switchSession: async () => {
          throw new Error("Use the conversation list to switch sessions.");
        },
        navigateTree: async () => {
          throw new Error(
            "Session tree navigation is not available in this prototype.",
          );
        },
      },
    });
    this.busy = false;
    this.refreshMessages();
    this.persist();
    this.changed();
    this.pluginEvent("session.ready");
  }
  private onEvent(event: AgentSessionEvent) {
    const e = event as unknown as Record<string, any>;
    if (e.type === "agent_start") this.busy = true;
    if (e.type === "message_update" && e.message?.role === "assistant")
      this.live = {
        id: `stream:${this.info.id}`,
        role: "assistant",
        text: contentText(e.message.content),
        thinking: (e.message.content ?? [])
          .filter((x: any) => x.type === "thinking")
          .map((x: any) => x.thinking)
          .join("\n"),
        streaming: true,
      };
    if (e.type === "message_end")
      queueMicrotask(() => {
        if (e.message?.role === "assistant") this.live = undefined;
        if (e.message?.role === "user") {
          const pending = this.store.get<PendingInput>(
            "pending-input",
            this.info.id,
          );
          const entry = this.agent.sessionManager
            .getBranch()
            .findLast((x) => x.type === "message" && x.message.role === "user");
          if (pending && !pending.persistedUserId && entry)
            this.store.put("pending-input", this.info.id, {
              ...pending,
              persistedUserId: entry.id,
            });
        }
        this.refreshMessages();
        this.persist();
        this.changed();
      });
    if (e.type === "entry_appended") {
      this.refreshMessages();
      this.persist();
    }
    if (
      e.type === "tool_execution_start" ||
      e.type === "tool_execution_update" ||
      e.type === "tool_execution_end"
    ) {
      const prior = this.liveTools.get(e.toolCallId);
      const result =
        e.type === "tool_execution_end"
          ? e.result
          : (e.partialResult ?? prior?.result);
      this.liveTools.set(e.toolCallId, {
        id: e.toolCallId,
        name: e.toolName,
        args: e.args ?? prior?.args ?? {},
        result,
        status:
          e.type === "tool_execution_end"
            ? e.isError
              ? "error"
              : "success"
            : "running",
        diff: diffFrom(result),
      });
    }
    if (e.type === "compaction_start") {
      this.busy = true;
      this.ui.statuses.compaction = "Compacting context…";
    }
    if (e.type === "compaction_end") {
      delete this.ui.statuses.compaction;
      if (e.errorMessage) this.ui.notify(e.errorMessage, "error");
    }
    if (e.type === "auto_retry_start")
      this.ui.statuses.retry = `Retrying (${e.attempt}/${e.maxAttempts})…`;
    if (e.type === "auto_retry_end") delete this.ui.statuses.retry;
    if (e.type === "agent_settled") {
      this.busy = false;
      this.live = undefined;
      this.liveTools.clear();
      this.refreshMessages();
      this.persist();
    }
    if (e.type === "session_info_changed" && e.name) {
      this.info.title = e.name;
      this.persist();
    }
    this.changed();
    // Plugins receive public activity; they do not receive credentials or private SDK services.
    if (!["message_update", "tool_execution_update"].includes(e.type))
      this.pluginEvent(e.type, e);
  }
  private pluginEvent(type: string, data?: unknown) {
    dispatchPluginEvent(
      this.plugins,
      { type, sessionId: this.info.id, projectId: this.project.id, data },
      (id) => this.pluginContext(id),
    );
  }
  private refreshMessages() {
    if (this.agent)
      this.messages = transcript(this.agent.sessionManager.getBranch());
  }
  private persist() {
    this.info.updatedAt = Date.now();
    this.store.put("session", this.info.id, this.info);
    this.store.put("transcript", this.info.id, this.messages);
    this.store.put("interrupted", this.info.id, this.busy);
    if (this.agent)
      this.store.put("pi-backup", this.info.id, {
        header: this.agent.sessionManager.getHeader(),
        entries: this.agent.sessionManager.getEntries(),
      });
  }
  changed() {
    if (this.disposing || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.events.emit("snapshot", this.snapshot());
    }, 35);
  }
  onSnapshot(listener: (snapshot: Snapshot) => void) {
    this.events.on("snapshot", listener);
    return () => this.events.off("snapshot", listener);
  }
  setComposer(text: string) {
    this.ui.editorText = text;
    this.store.put("composer", this.info.id, text);
  }
  answerDialog(id: string, value: unknown, cancelled = false) {
    this.ui.answer(id, value, cancelled);
  }
  dismissNotice(id: string) {
    this.ui.dismiss(id);
  }
  notifyError(error: unknown) {
    this.ui.notify(errorText(error), "error");
  }
  async pluginAction(pluginId: string, action: string, input: unknown) {
    const p = this.plugins.find((p) => p.id === pluginId);
    if (!p?.action) throw new Error("Plugin action not found.");
    this.pluginOperations++;
    try {
      return await p.action(action, input, this.pluginContext(p.id));
    } finally {
      this.pluginOperations--;
    }
  }
  snapshot(): Snapshot {
    const messages = this.messages.map((m) =>
      m.tool && this.liveTools.has(m.tool.id)
        ? { ...m, tool: this.liveTools.get(m.tool.id) }
        : m,
    );
    if (this.live) messages.push(this.live);
    for (const t of this.liveTools.values())
      if (!messages.some((m) => m.tool?.id === t.id))
        messages.push({ id: `tool:${t.id}`, role: "tool", text: "", tool: t });
    return {
      session: this.info,
      messages,
      comments: this.store.comments(this.info.id),
      composer: this.ui.editorText,
      composerRevision:
        this.store.get<number>("composer-revision", this.info.id) ?? 0,
      busy: this.busy,
      dialogs: [...this.ui.dialogs.values()],
      notices: this.ui.notices,
      statuses: this.ui.statuses,
      widgets: this.ui.widgets,
      skills:
        this.agent?.resourceLoader.getSkills().skills.map((s) => ({
          name: s.name,
          description: s.description,
          filePath: s.filePath,
        })) ?? [],
      pluginState: this.pluginState,
      thinking: this.agent
        ? {
            level: this.agent.thinkingLevel,
            available: this.agent.getAvailableThinkingLevels(),
          }
        : undefined,
    };
  }
  async send(batch: FeedbackBatch) {
    const existing = this.store.batch(this.info.id, batch.id);
    if (existing) return { status: existing.status };
    if (this.busy || this.ui.dialogs.size)
      throw new Error(
        "Wait for the current response or answer the active question first. Draft comments are saved.",
      );
    await this.ready;
    if (this.busy || this.ui.dialogs.size)
      throw new Error("Another operation has started. Your draft is saved.");
    if (this.agent.isCompacting)
      throw new Error(
        "Context is compacting. Your draft is saved; send it when compaction finishes.",
      );
    let prompt = formatFeedback(
      batch,
      this.store.comments(this.info.id),
      this.messages,
    );
    if (batch.skill) {
      if (
        !this.agent.resourceLoader
          .getSkills()
          .skills.some((s) => s.name === batch.skill)
      )
        throw new Error("This skill is no longer available. Reload skills.");
      prompt = `/skill:${batch.skill} ${prompt}`;
    }
    this.submitting = {
      comments: this.store
        .comments(this.info.id)
        .filter((c) => batch.commentIds.includes(c.id)),
      note: batch.note,
    };
    this.store.put("pending-input", this.info.id, {
      prompt,
      accepted: false,
      batchId: batch.id,
      note: batch.note,
    });
    this.store.markBatch(this.info.id, batch.id, "submitting");
    this.busy = true;
    this.persist();
    this.changed();
    let accepted = false;
    void this.agent
      .prompt(prompt, {
        preflightResult: (ok) => {
          accepted = ok;
          this.store.markBatch(
            this.info.id,
            batch.id,
            ok ? "accepted" : "rejected",
          );
          this.store.put("pending-input", this.info.id, {
            ...this.store.get<PendingInput>("pending-input", this.info.id),
            prompt,
            accepted: ok,
            batchId: batch.id,
            note: batch.note,
          });
          if (ok) {
            const comments = this.store
              .comments(this.info.id)
              .map((c) =>
                batch.commentIds.includes(c.id)
                  ? { ...c, status: "sent" as const, batchId: batch.id }
                  : c,
              );
            this.store.put("comments", this.info.id, comments);
            if (this.ui.editorText === batch.note) {
              this.ui.editorText = "";
              this.store.put("composer", this.info.id, "");
            }
            if (this.info.title === "New conversation") {
              this.info.title = (
                batch.note.trim() ||
                comments.find((c) => c.batchId === batch.id)?.text ||
                "Review"
              ).slice(0, 64);
              this.persist();
            }
          }
          this.submitting = undefined;
          this.changed();
        },
      })
      .catch((e) => {
        this.ui.notify(errorText(e), "error");
        if (!accepted) this.store.markBatch(this.info.id, batch.id, "rejected");
      })
      .finally(() => {
        this.submitting = undefined;
        this.busy = false;
        this.refreshMessages();
        this.persist();
        this.changed();
      });
    return { status: "submitting" };
  }
  saveComments(comments: Comment[]) {
    const existing = this.store.comments(this.info.id);
    if (
      this.submitting?.comments.some(
        (c) =>
          JSON.stringify(c) !==
          JSON.stringify(comments.find((x) => x.id === c.id)),
      )
    )
      throw new Error(
        "These comments are being submitted. Add a new comment or wait for submission to finish.",
      );
    for (const c of comments) {
      const old = existing.find((x) => x.id === c.id);
      if (old?.status !== "draft" && old) {
        if (
          old.text !== c.text ||
          JSON.stringify(old.anchor) !== JSON.stringify(c.anchor) ||
          c.status === "draft" ||
          c.batchId !== old.batchId
        )
          throw new Error(
            "Sent comments are immutable; add a new comment to follow up.",
          );
      } else if (c.status !== "draft")
        throw new Error("New comments must be drafts.");
      if (
        !this.messages.some(
          (m) => m.id === c.anchor.messageId && m.role === "assistant",
        )
      )
        throw new Error("Comment must reference a saved assistant reply.");
    }
    if (
      existing.some(
        (c) => c.status !== "draft" && !comments.some((x) => x.id === c.id),
      )
    )
      throw new Error("Sent comments cannot be deleted.");
    this.store.put("comments", this.info.id, comments);
    this.changed();
  }
  async stop() {
    this.ui.cancelAll();
    if (this.agent) {
      this.agent.abortCompaction();
      this.agent.abortBranchSummary();
      await this.agent.abort();
    }
    this.busy = false;
    this.live = undefined;
    this.refreshMessages();
    this.changed();
  }
  async reload() {
    if (this.busy)
      throw new Error(
        "Wait for the response to finish before reloading skills.",
      );
    this.busy = true;
    this.changed();
    try {
      if (!this.agent) {
        this.ready = this.initialize();
        await this.ready;
      } else await this.agent.reload();
    } finally {
      this.busy = false;
      this.changed();
    }
  }
  async setModel(provider: string, id: string) {
    if (this.busy)
      throw new Error("Stop or finish the response before changing models.");
    const m = (await this.models.getAvailable(provider)).find(
      (m) => m.id === id,
    );
    if (!m) throw new Error("This model is not authenticated or available.");
    this.info.model = modelInfo(this.models, m);
    if (!this.agent) {
      this.busy = true;
      this.ready = this.initialize();
      try {
        await this.ready;
      } finally {
        this.busy = false;
        this.changed();
      }
    } else await this.agent.setModel(m);
    this.persist();
    this.changed();
  }
  async setThinking(level: string) {
    if (this.busy)
      throw new Error(
        "Finish or stop the response before changing thinking effort.",
      );
    await this.ready;
    if (this.busy)
      throw new Error(
        "Another operation has started. Try again when it finishes.",
      );
    const supported = this.agent.getAvailableThinkingLevels();
    const selected = supported.find((candidate) => candidate === level);
    if (!selected)
      throw new Error("This model does not support that thinking effort.");
    this.agent.setThinkingLevel(selected, { persist: false });
    this.persist();
    this.changed();
  }
  pluginContext(id: string): PluginContext {
    return {
      project: this.project,
      sessionId: this.info.id,
      storage: pluginStorage(this.store, id, this.project.id),
      publish: (state) => {
        if (state === undefined) delete this.pluginState[id];
        else {
          try {
            this.pluginState[id] = JSON.parse(JSON.stringify(state));
          } catch {
            throw new Error(
              `Plugin ${id} published non-JSON state. Use serializable data.`,
            );
          }
        }
        this.changed();
      },
      notify: (text) => this.ui.notify(text),
      getMessages: () => structuredClone(this.messages),
      createAgent: async (options) => {
        const model = this.models.getModel(options.provider, options.model);
        if (!model) throw new Error("Unknown background model.");
        const loader = new DefaultResourceLoader({
          cwd: this.project.path,
          agentDir: getAgentDir(),
          noExtensions: true,
        });
        await loader.reload();
        const { session } = await createAgentSession({
          cwd: this.project.path,
          modelRuntime: this.models,
          model,
          tools: options.tools ?? [],
          resourceLoader: loader,
          sessionManager: SessionManager.create(
            this.project.path,
            join(this.dataDir, "background", id),
          ),
        });
        const child: BackgroundAgent = {
          prompt: async (text) => {
            this.childOperations++;
            try {
              await session.prompt(text);
            } finally {
              this.childOperations--;
            }
          },
          subscribe: (listener) =>
            session.subscribe((e) =>
              listener({
                type: e.type,
                sessionId: session.sessionId,
                projectId: this.project.id,
                data: e,
              }),
            ),
          stop: () => session.abort(),
          dispose: async () => {
            await session.abort();
            session.dispose();
            this.children.delete(child);
          },
        };
        this.children.add(child);
        return child;
      },
    };
  }
  async dispose() {
    this.disposing = true;
    this.ui.dispose();
    if (this.timer) clearTimeout(this.timer);
    await this.stop();
    // Startup must finish before deletion can remove the final native file and records.
    await this.ready.catch(() => {});
    await this.stop();
    for (const c of this.children) await c.dispose();
    this.agent?.dispose();
    this.events.removeAllListeners();
  }
  hasActiveWork() {
    return (
      this.busy ||
      this.ui.dialogs.size > 0 ||
      this.childOperations > 0 ||
      this.pluginOperations > 0
    );
  }
}
export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
