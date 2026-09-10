import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  Folder,
  FolderPlus,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  RefreshCw,
  Square,
  Terminal,
  Trash2,
  X,
  Pencil,
  Plug,
  CornerDownRight,
} from "lucide-react";
import type {
  Anchor,
  Comment,
  ModelInfo,
  Project,
  SessionInfo,
  Snapshot,
  ExecutionInfo,
} from "../shared/types.ts";
import { api } from "./api.ts";
import { anchorFromRange, rangeForAnchor } from "./anchors.ts";
import { Markdown } from "./Markdown.tsx";
import { ToolCard } from "./ToolCard.tsx";
import { DialogCard } from "./DialogCard.tsx";
import { browserPlugins } from "./plugins.ts";
import type { BrowserPluginContext } from "./plugin-api.ts";
import { PluginBoundary } from "./PluginBoundary.tsx";
import { CustomMessage } from "./CustomMessage.tsx";

interface Bootstrap {
  projects: Project[];
  sessions: SessionInfo[];
  models: ModelInfo[];
  modelError?: string;
  readOnlyAuth: boolean;
  execution?: ExecutionInfo;
}
interface DraftComment {
  id?: string;
  anchor: Anchor;
  text: string;
}
export function App() {
  const [boot, setBoot] = useState<Bootstrap>({
    projects: [],
    sessions: [],
    models: [],
    readOnlyAuth: false,
  });
  const [projectId, setProjectId] = useState(""),
    [sessionId, setSessionId] = useState<string | null>(
      localStorage.getItem("margin.session"),
    );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [rail, setRail] = useState(false),
    [sidebar, setSidebar] = useState(() => window.innerWidth > 650);
  const [draft, setDraft] = useState(""),
    [skill, setSkill] = useState(""),
    [editing, setEditing] = useState<DraftComment | null>(null),
    [active, setActive] = useState<string | null>(null);
  const [selection, setSelection] = useState<{
      anchor: Anchor;
      x: number;
      y: number;
    } | null>(null),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [sending, setSending] = useState(false);
  const [projectForm, setProjectForm] = useState(false),
    [folderPath, setFolderPath] = useState(""),
    [newModel, setNewModel] = useState("");
  const [panel, setPanel] = useState<string | null>(null),
    [commentGaps, setCommentGaps] = useState<Record<string, number>>({});
  const draftRef = useRef(""),
    dirty = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    scrollRef = useRef<HTMLDivElement>(null),
    railList = useRef<HTMLDivElement>(null);
  const stickyBottom = useRef(true),
    selectedId = useRef(sessionId),
    lastAccepted = useRef<string>("");
  const draftVersion = useRef(0),
    saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const currentProject = boot.projects.find(
    (p) => p.id === (snapshot?.session.projectId ?? projectId),
  );
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const refresh = useCallback(async () => {
    const b = await api<Bootstrap>("/bootstrap");
    setBoot(b);
    setProjectId((p) => p || b.projects[0]?.id || "");
    setNewModel(
      (v) =>
        v ||
        modelKey(
          b.models.find(
            (m) => m.provider === "openai-codex" && m.id === "gpt-5.6-sol",
          ) ??
            b.models.find((m) => m.provider === "openai-codex") ??
            b.models[0],
        ),
    );
  }, []);
  useEffect(() => {
    void refresh().catch(fail);
  }, [refresh]);
  useEffect(() => {
    selectedId.current = sessionId;
    setSnapshot(null);
    setConnected(false);
    setEditing(null);
    setSelection(null);
    setActive(null);
    setSkill("");
    setRail(false);
    setPanel(null);
    dirty.current = false;
    stickyBottom.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!sessionId) {
      setDraft("");
      draftRef.current = "";
      return;
    }
    localStorage.setItem("margin.session", sessionId);
    const stream = new EventSource(`/api/sessions/${sessionId}/events`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (e) => {
      const { snapshot: s } = JSON.parse(e.data) as { snapshot: Snapshot };
      if (selectedId.current !== s.session.id) return;
      setSnapshot(s);
      setProjectId(s.session.projectId);
      if (!dirty.current) {
        setDraft(s.composer);
        draftRef.current = s.composer;
      }
      setBoot((b) => ({
        ...b,
        sessions: [
          s.session,
          ...b.sessions.filter((x) => x.id !== s.session.id),
        ],
      }));
    };
    return () => stream.close();
  }, [sessionId]);
  useEffect(() => {
    if (stickyBottom.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    snapshot?.messages.length,
    snapshot?.messages.at(-1)?.text,
    snapshot?.dialogs.length,
  ]);
  function updateDraft(text: string) {
    setDraft(text);
    draftRef.current = text;
    dirty.current = true;
    const version = ++draftVersion.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (sessionId) {
      const id = sessionId;
      saveTimer.current = setTimeout(
        () => void persistDraft(id, text, version).catch(fail),
        250,
      );
    }
  }
  function persistDraft(id: string, text: string, version: number) {
    const request = saveChain.current
      .catch(() => {})
      .then(() => api(`/sessions/${id}/composer`, { text }, "PUT"));
    saveChain.current = request;
    return request.then(() => {
      if (selectedId.current === id && draftVersion.current === version)
        dirty.current = false;
    });
  }
  async function flushDraft() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (sessionId && dirty.current)
      await persistDraft(sessionId, draftRef.current, draftVersion.current);
    else await saveChain.current;
  }
  async function switchSession(id: string | null) {
    if (editing) {
      setError(
        "Finish or cancel your draft comment before changing conversations.",
      );
      return;
    }
    try {
      await flushDraft();
      setSessionId(id);
      setError("");
    } catch (e) {
      fail(e);
    }
  }
  async function createSession() {
    if (editing) {
      setError(
        "Finish or cancel your draft comment before starting a conversation.",
      );
      return;
    }
    setSending(true);
    try {
      await flushDraft();
      const s = await api<Snapshot>("/sessions", {
        projectId,
        model: boot.models.find((m) => modelKey(m) === newModel),
      });
      setSessionId(s.session.id);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  }
  async function addProject() {
    try {
      const p = await api<Project>("/projects", { path: folderPath });
      await flushDraft();
      setBoot((b) => ({
        ...b,
        projects: b.projects.some((x) => x.id === p.id)
          ? b.projects
          : [...b.projects, p],
      }));
      setProjectId(p.id);
      setSessionId(null);
      setProjectForm(false);
      setFolderPath("");
    } catch (e) {
      fail(e);
    }
  }
  async function saveComments(comments: Comment[]) {
    await api(`/sessions/${sessionId}/comments`, comments, "PUT");
    setSnapshot((s) => (s ? { ...s, comments } : s));
  }
  async function saveComment() {
    if (!editing || !snapshot || !editing.text.trim()) return;
    try {
      const id = editing.id ?? crypto.randomUUID();
      const existing = snapshot.comments.find((c) => c.id === id);
      const c: Comment = existing
        ? { ...existing, text: editing.text.trim() }
        : {
            id,
            anchor: editing.anchor,
            text: editing.text.trim(),
            status: "draft",
            createdAt: Date.now(),
          };
      await saveComments([...snapshot.comments.filter((x) => x.id !== id), c]);
      setEditing(null);
      setActive(id);
    } catch (e) {
      fail(e);
    }
  }
  async function send() {
    if (!snapshot) return;
    setSending(true);
    setError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const note = draftRef.current,
      version = draftVersion.current,
      sendingSession = sessionId,
      ids = snapshot.comments
        .filter((c) => c.status === "draft")
        .map((c) => c.id);
    const fingerprint = JSON.stringify({ note, ids, skill });
    // Reuse an id after a transport error; the server will never enqueue that batch twice.
    const prior = lastAccepted.current
      ? (JSON.parse(lastAccepted.current) as {
          fingerprint: string;
          id: string;
        })
      : null;
    const id =
      prior?.fingerprint === fingerprint ? prior.id : crypto.randomUUID();
    lastAccepted.current = JSON.stringify({ fingerprint, id });
    try {
      await flushDraft();
      const result = await api<{ status: string }>(
        `/sessions/${sendingSession}/send`,
        { id, note, commentIds: ids, ...(skill ? { skill } : {}) },
      );
      if (result.status === "rejected") {
        lastAccepted.current = "";
        throw new Error(
          "Pi did not accept that message. Your draft is saved; try again.",
        );
      }
      if (selectedId.current === sendingSession) {
        if (draftVersion.current === version) dirty.current = false;
        setSkill("");
        stickyBottom.current = true;
      }
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  }
  function startComment(anchor: Anchor) {
    if (editing) {
      setError("Finish or cancel your current comment first.");
      return;
    }
    setEditing({ anchor, text: "" });
    setActive("editing");
    setRail(true);
    setPanel(null);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    stickyBottom.current = false;
  }
  function showComments(open: boolean) {
    if (!open && editing) {
      setError("Finish or cancel your draft comment before closing the panel.");
      return;
    }
    setRail(open);
    setPanel(null);
    if (open && window.innerWidth <= 900)
      requestAnimationFrame(() =>
        document
          .querySelector(".comment-rail")
          ?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
  }
  function captureSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setSelection(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const el = (
      range.startContainer.nodeType === 1
        ? range.startContainer
        : range.startContainer.parentElement
    ) as HTMLElement;
    const root = el.closest<HTMLElement>("[data-annotation-root]");
    if (!root || !root.dataset.messageId) return;
    const anchor = anchorFromRange(root, range, root.dataset.messageId);
    if (!anchor) return;
    const box = range.getBoundingClientRect();
    setSelection({
      anchor,
      x: Math.min(window.innerWidth - 140, Math.max(8, box.left)),
      y: Math.max(8, box.top - 44),
    });
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        captureSelection();
      }
      if (e.key === "Escape") setSelection(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  function jump(c: Comment) {
    setActive(c.id);
    setRail(true);
    setPanel(null);
    const root = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(c.anchor.messageId)}"]`,
    );
    const range = root && rangeForAnchor(root, c.anchor);
    const scroller = scrollRef.current;
    if (root && scroller) {
      const rect =
        range?.getBoundingClientRect() ?? root.getBoundingClientRect();
      scroller.scrollBy({
        top:
          rect.top -
          scroller.getBoundingClientRect().top -
          scroller.clientHeight * 0.3,
        behavior: "smooth",
      });
      if (!range)
        setError(
          "The original quote could not be highlighted. Its saved text is still shown in the comment.",
        );
    }
  }
  const allComments = [
    ...(snapshot?.comments ?? []),
    ...(editing && !editing.id
      ? [
          {
            id: "editing",
            anchor: editing.anchor,
            text: editing.text,
            status: "draft" as const,
            createdAt: Date.now(),
          },
        ]
      : []),
  ].sort((a, b) => {
    const msgs = snapshot?.messages ?? [];
    return (
      msgs.findIndex((m) => m.id === a.anchor.messageId) -
        msgs.findIndex((m) => m.id === b.anchor.messageId) ||
      a.anchor.start - b.anchor.start
    );
  });
  useLayoutEffect(() => {
    const ranges: Range[] = [],
      activeRanges: Range[] = [];
    const gaps: Record<string, number> = {};
    let used = 0;
    const origin = railList.current?.getBoundingClientRect().top ?? 0;
    for (const c of allComments) {
      const root = document.querySelector<HTMLElement>(
        `[data-message-id="${CSS.escape(c.anchor.messageId)}"]`,
      );
      const r = root && rangeForAnchor(root, c.anchor);
      if (r && c.status !== "resolved")
        (c.id === active ? activeRanges : ranges).push(r);
      const card = document.querySelector<HTMLElement>(
        `[data-comment-id="${CSS.escape(c.id)}"]`,
      );
      const desired = r?.getBoundingClientRect().top ?? origin;
      const gap =
        window.innerWidth > 1050 ? Math.max(12, desired - origin - used) : 12;
      gaps[c.id] = gap;
      used += gap + (card?.getBoundingClientRect().height ?? 160);
    }
    const H = (
      window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;
    const highlights = (CSS as unknown as { highlights?: Map<string, unknown> })
      .highlights;
    if (H && highlights) {
      highlights.set("margin-comments", new H(...ranges));
      highlights.set("margin-active", new H(...activeRanges));
    }
    setCommentGaps((prev) =>
      JSON.stringify(prev) === JSON.stringify(gaps) ? prev : gaps,
    );
  }, [snapshot?.messages, snapshot?.comments, editing, active, rail, sidebar]);
  const pluginContext = (id: string): BrowserPluginContext => ({
    snapshot: snapshot!,
    state: snapshot?.pluginState[id],
    action: (name, input) =>
      api(`/sessions/${sessionId}/plugins/${id}/${name}`, input),
    setComposer: updateDraft,
  });
  const draftCount =
    snapshot?.comments.filter((c) => c.status === "draft").length ?? 0;
  const busy = snapshot?.busy ?? false;
  const model = snapshot?.session.model;
  const agentName = snapshot?.session.backendLabel ?? "Pi";
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      <header className="app-header">
        <div className="brand">
          <PanelRight size={21} />
          <span>margin</span>
          <span className="local-badge">
            <i />
            local workspace
          </span>
        </div>
        <div className="header-right">
          <span
            className="execution-mode"
            title={
              boot.execution?.mode === "cco"
                ? `Whole server launched through cco defaults. Writable application paths: ${boot.execution.writablePaths.join(", ")}. cco also permits its normal state and temporary paths.`
                : "This server was started directly, without the cco wrapper."
            }
          >
            {boot.execution?.mode === "cco" ? "cco sandbox" : "Native"}
          </span>
          <span className="powered">Powered by Pi</span>
          <span className={`connection ${connected ? "connected" : ""}`}>
            <Circle size={7} fill="currentColor" />
            {sessionId ? (connected ? "Connected" : "Reconnecting…") : "Ready"}
          </span>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>WORKSPACE</span>
            <button
              className="mobile-close"
              aria-label="Close sidebar"
              onClick={() => setSidebar(false)}
            >
              <X size={16} />
            </button>
            <button
              aria-label="Add project"
              title="Add project"
              onClick={() => setProjectForm(true)}
            >
              <FolderPlus size={16} />
            </button>
          </div>
          <select
            className="project-select"
            aria-label="Project"
            value={projectId}
            onChange={(e) => {
              if (editing) {
                setError("Finish or cancel your draft comment first.");
                return;
              }
              setProjectId(e.target.value);
              void switchSession(null);
            }}
          >
            {boot.projects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {boot.execution?.mode === "cco" &&
            currentProject?.launchWritable === false && (
              <p className="scope-hint">
                This folder is outside the writable project paths for this
                launch. To allow edits here, restart with <code>--add-dir</code>{" "}
                and this folder.
              </p>
            )}
          <button
            className="new-chat"
            onClick={() => void createSession()}
            disabled={sending || !projectId}
          >
            <Plus size={16} />
            New conversation<span>⌘</span>
          </button>
          <div className="section-label">CONVERSATIONS</div>
          <nav className="session-list" aria-label="Conversations">
            {boot.sessions
              .filter((s) => s.projectId === projectId)
              .map((s) => (
                <button
                  className={sessionId === s.id ? "selected" : ""}
                  key={s.id}
                  onClick={() => void switchSession(s.id)}
                >
                  <MessageSquare size={15} />
                  <span>{s.title}</span>
                </button>
              ))}
            {!boot.sessions.some((s) => s.projectId === projectId) && (
              <p className="sidebar-empty">
                Your conversations will appear here.
              </p>
            )}
          </nav>
          <div className="sidebar-footer">
            <BookOpen size={15} />
            <span>Skills from Pi, room for your ideas.</span>
          </div>
        </aside>
        <main className="main">
          <div className="toolbar">
            <div className="toolbar-left">
              <button
                aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
                onClick={() => setSidebar(!sidebar)}
              >
                {sidebar ? (
                  <PanelLeftClose size={18} />
                ) : (
                  <PanelLeftOpen size={18} />
                )}
              </button>
              <Folder size={15} />
              <span className="project-breadcrumb" title={currentProject?.path}>
                {currentProject?.name ?? "Workspace"}
              </span>
              <span className="crumb-separator">/</span>
              <span className="conversation-title">
                {snapshot?.session.title ?? "New conversation"}
              </span>
            </div>
            <div className="toolbar-actions">
              {browserPlugins.flatMap(
                (p) =>
                  p.panels?.map((x) => (
                    <button
                      key={`${p.id}:${x.id}`}
                      className={
                        panel === `${p.id}:${x.id}` ? "active-button" : ""
                      }
                      onClick={() => {
                        setPanel(
                          panel === `${p.id}:${x.id}`
                            ? null
                            : `${p.id}:${x.id}`,
                        );
                        setRail(false);
                      }}
                    >
                      <Plug size={15} />
                      {x.title}
                    </button>
                  )) ?? [],
              )}
              <button
                className={rail ? "active-button" : ""}
                disabled={!snapshot}
                onClick={() => showComments(!rail)}
              >
                <MessageSquare size={16} />
                Comments
                {snapshot?.comments.length ? (
                  <span className="count">{snapshot.comments.length}</span>
                ) : null}
              </button>
            </div>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {boot.modelError && !sessionId && (
            <div className="notice error">{boot.modelError}</div>
          )}
          {snapshot?.notices.map((n) => (
            <div className={`notice ${n.level}`} key={n.id}>
              <span>{n.text}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() =>
                  void api(
                    `/sessions/${sessionId}/notices/${n.id}/dismiss`,
                    {},
                  ).catch(fail)
                }
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <div
            className="scroll-area"
            ref={scrollRef}
            onScroll={() => {
              const e = scrollRef.current!;
              stickyBottom.current =
                e.scrollHeight - e.scrollTop - e.clientHeight < 90;
              if (window.getSelection()?.isCollapsed) setSelection(null);
              else captureSelection();
            }}
          >
            {!snapshot ? (
              <div className="welcome">
                <div className="welcome-icon">
                  <PanelRight size={32} />
                </div>
                <p className="eyebrow">A LITTLE SPACE TO THINK</p>
                <h1>
                  Good ideas deserve
                  <br />a conversation.
                </h1>
                <p className="welcome-copy">
                  Work with Pi. Read closely, leave comments in the margin,
                  <br className="desktop-break" /> and shape the next step
                  together.
                </p>
                <div className="start-card">
                  <label htmlFor="start-model">Start with a model</label>
                  <select
                    id="start-model"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                  >
                    {boot.models.map((m) => (
                      <option key={modelKey(m)} value={modelKey(m)}>
                        {m.name} · {m.provider}
                      </option>
                    ))}
                  </select>
                  <button
                    className="primary"
                    onClick={() => void createSession()}
                    disabled={sending || !boot.models.length || !projectId}
                  >
                    <Plus size={16} />
                    Start a conversation
                  </button>
                </div>
                {!boot.models.length && (
                  <p className="setup-hint">
                    Sign in through <code>pi</code> → <code>/login</code>, then{" "}
                    <button
                      className="text-link"
                      onClick={() =>
                        void api("/models/refresh", {})
                          .then(refresh)
                          .catch(fail)
                      }
                    >
                      refresh models
                    </button>
                    .
                  </p>
                )}
                <div className="welcome-steps">
                  <span>
                    <BookOpen size={17} />
                    Choose a skill, or just talk
                  </span>
                  <span>
                    <MessageSquarePlus size={17} />
                    Select any passage to comment
                  </span>
                  <span>
                    <CornerDownRight size={17} />
                    Send your thoughts together
                  </span>
                </div>
              </div>
            ) : (
              <div className={`review ${rail || panel ? "with-rail" : ""}`}>
                <div className="thread">
                  <div className="conversation-date">
                    {new Date(snapshot.session.createdAt).toLocaleDateString(
                      undefined,
                      { month: "long", day: "numeric" },
                    )}
                  </div>
                  {!snapshot.messages.length && (
                    <div className="empty-conversation">
                      <div className="agent-avatar">
                        <Terminal size={18} />
                      </div>
                      <h2>What would you like to work on?</h2>
                      <p>
                        Choose a skill below to guide the conversation,
                        <br />
                        or start with whatever is on your mind.
                      </p>
                    </div>
                  )}
                  {snapshot.messages.map((m) =>
                    m.role === "tool" && m.tool ? (
                      <ToolCard
                        key={m.id}
                        tool={m.tool}
                        context={pluginContext}
                      />
                    ) : m.role === "custom" ? (
                      <CustomMessage
                        key={m.id}
                        message={m}
                        context={pluginContext}
                      />
                    ) : (
                      <article
                        key={m.id}
                        className={`message ${m.role}`}
                        aria-label={
                          m.role === "assistant"
                            ? "Assistant reply"
                            : "Your message"
                        }
                      >
                        {m.role === "assistant" ? (
                          <>
                            <div className="agent-label">
                              <div className="agent-avatar">
                                <Terminal size={15} />
                              </div>
                              <span>{agentName}</span>
                              <span className="agent-model">{model?.name}</span>
                              {m.streaming && (
                                <span className="streaming-dot" />
                              )}
                            </div>
                            {m.thinking && (
                              <details className="thinking">
                                <summary>Thinking</summary>
                                <Markdown text={m.thinking} />
                              </details>
                            )}
                            <div
                              className="markdown"
                              data-annotation-root={
                                m.streaming ? undefined : ""
                              }
                              data-message-id={m.id}
                              onMouseUp={() => setTimeout(captureSelection, 0)}
                              onKeyUp={captureSelection}
                              onClick={(e) => {
                                if (window.getSelection()?.toString()) return;
                                for (const c of snapshot.comments.filter(
                                  (c) =>
                                    c.anchor.messageId === m.id &&
                                    c.status !== "resolved",
                                )) {
                                  const r = rangeForAnchor(
                                    e.currentTarget,
                                    c.anchor,
                                  );
                                  if (
                                    r &&
                                    [...r.getClientRects()].some(
                                      (rect) =>
                                        e.clientX >= rect.left &&
                                        e.clientX <= rect.right &&
                                        e.clientY >= rect.top &&
                                        e.clientY <= rect.bottom,
                                    )
                                  ) {
                                    e.preventDefault();
                                    setActive(c.id);
                                    setRail(true);
                                    break;
                                  }
                                }
                              }}
                            >
                              <Markdown text={m.text} />
                            </div>
                            {m.error && (
                              <p className="error-text" role="alert">
                                {m.error}
                              </p>
                            )}
                            {!m.streaming && m.text && (
                              <div className="message-actions">
                                <button
                                  className="small muted"
                                  onClick={() => {
                                    const root =
                                      document.querySelector<HTMLElement>(
                                        `[data-message-id="${CSS.escape(m.id)}"]`,
                                      );
                                    if (root) {
                                      const r = document.createRange();
                                      r.selectNodeContents(root);
                                      const a = anchorFromRange(root, r, m.id);
                                      if (a) startComment(a);
                                    }
                                  }}
                                >
                                  <MessageSquarePlus size={14} />
                                  Comment on reply
                                </button>
                                {browserPlugins.flatMap(
                                  (p) =>
                                    p.messageActions?.map((a) => (
                                      <button
                                        className="small muted"
                                        key={`${p.id}:${a.id}`}
                                        onClick={() =>
                                          void Promise.resolve()
                                            .then(() =>
                                              a.run(m, pluginContext(p.id)),
                                            )
                                            .catch(fail)
                                        }
                                      >
                                        {a.label}
                                      </button>
                                    )) ?? [],
                                )}
                              </div>
                            )}
                          </>
                        ) : (
                          <div>
                            {m.skill && (
                              <div className="skill-used">
                                <BookOpen size={12} />
                                {m.skill}
                              </div>
                            )}
                            <UserMessage text={m.text} />
                          </div>
                        )}
                      </article>
                    ),
                  )}
                  {busy && (
                    <div className="working">
                      <span className="streaming-dot" />
                      {Object.values(snapshot.statuses).at(-1) ??
                        (snapshot.dialogs.length
                          ? "Waiting for you"
                          : `${agentName} is working…`)}
                    </div>
                  )}
                  {Object.entries(snapshot.widgets).map(([key, lines]) => (
                    <div className="widget" key={key}>
                      {lines.map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </div>
                  ))}
                  {snapshot.dialogs.map((d) => (
                    <DialogCard
                      key={d.id}
                      dialog={d}
                      onAnswer={async (id, value, cancelled) => {
                        await api(`/sessions/${sessionId}/dialogs/${id}`, {
                          value,
                          cancelled,
                        });
                      }}
                    />
                  ))}
                  <form
                    className="composer"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    {draftCount > 0 && (
                      <button
                        type="button"
                        className="batch-chip"
                        onClick={() => showComments(true)}
                      >
                        <MessageSquare size={13} />
                        {draftCount} draft comment{draftCount === 1 ? "" : "s"}{" "}
                        attached
                      </button>
                    )}
                    <textarea
                      aria-label={`Message ${agentName}`}
                      placeholder={
                        draftCount
                          ? "Add an overall reply (optional)…"
                          : `Message ${agentName}, or select a passage above to comment…`
                      }
                      value={draft}
                      onChange={(e) => updateDraft(e.target.value)}
                      rows={3}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          if (!busy && !editing) void send();
                        }
                      }}
                    />
                    <div className="composer-footer">
                      <div className="composer-options">
                        <label className="skill-choice">
                          <BookOpen size={14} />
                          <select
                            aria-label="Starting skill"
                            value={skill}
                            onChange={(e) => setSkill(e.target.value)}
                            disabled={busy}
                          >
                            <option value="">No skill</option>
                            {snapshot.skills.map((s) => (
                              <option key={s.filePath} value={s.name}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          aria-label="Reload skills"
                          title="Reload Pi skills and extensions"
                          disabled={busy}
                          onClick={() =>
                            void api(`/sessions/${sessionId}/reload`, {}).catch(
                              fail,
                            )
                          }
                        >
                          <RefreshCw size={13} />
                        </button>
                      </div>
                      {busy ? (
                        <button
                          type="button"
                          className="stop-button"
                          onClick={() =>
                            void api(`/sessions/${sessionId}/stop`, {}).catch(
                              fail,
                            )
                          }
                        >
                          <Square size={12} fill="currentColor" />
                          Stop
                        </button>
                      ) : (
                        <button
                          className="send-button"
                          aria-label={
                            draftCount
                              ? `Send ${draftCount} comment${draftCount === 1 ? "" : "s"}`
                              : "Send message"
                          }
                          type="submit"
                          disabled={
                            sending ||
                            !!editing ||
                            (!draft.trim() && !draftCount) ||
                            !connected
                          }
                        >
                          <ArrowUp size={19} />
                        </button>
                      )}
                    </div>
                  </form>
                  <div className="composer-hint">
                    <span>
                      {editing
                        ? "Finish or cancel your draft comment before sending."
                        : skill
                          ? `${skill} will guide your next message`
                          : "Your skill sets the pace. Your comments shape the work."}
                    </span>
                    <kbd>⌘ ↵</kbd>
                  </div>
                  {model && (
                    <div className="model-footer">
                      <span className="model-dot" />
                      <select
                        aria-label="Model"
                        disabled={busy}
                        value={modelKey(model)}
                        onChange={(e) => {
                          const m = boot.models.find(
                            (m) => modelKey(m) === e.target.value,
                          );
                          if (m)
                            void api(`/sessions/${sessionId}/model`, {
                              provider: m.provider,
                              id: m.id,
                            }).catch(fail);
                        }}
                      >
                        {boot.models.map((m) => (
                          <option key={modelKey(m)} value={modelKey(m)}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                      {snapshot.thinking && (
                        <label className="thinking-choice">
                          <span>Thinking</span>
                          <select
                            aria-label="Thinking effort"
                            disabled={
                              busy || snapshot.thinking.available.length < 2
                            }
                            value={snapshot.thinking.level}
                            onChange={(event) =>
                              void api(`/sessions/${sessionId}/thinking`, {
                                level: event.target.value,
                              }).catch(fail)
                            }
                          >
                            {snapshot.thinking.available.map((level) => (
                              <option key={level} value={level}>
                                {level === "xhigh"
                                  ? "Extra high"
                                  : level.charAt(0).toUpperCase() +
                                    level.slice(1)}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <span>
                        {model.provider === "openai-codex" && model.subscription
                          ? "ChatGPT subscription"
                          : model.provider === "anthropic" && model.subscription
                            ? "Claude · extra usage"
                            : model.provider}
                      </span>
                    </div>
                  )}
                </div>
                {rail && (
                  <aside className="comment-rail" aria-label="Comments">
                    <div className="rail-heading">
                      <div>
                        <MessageSquare size={16} />
                        <strong>Comments</strong>
                        <span className="count">
                          {snapshot.comments.length}
                        </span>
                      </div>
                      <button
                        aria-label="Close comments"
                        onClick={() => showComments(false)}
                      >
                        <X size={17} />
                      </button>
                    </div>
                    <p className="rail-hint">
                      A thought here. A question there.
                      <br />
                      Send them together when you’re ready.
                    </p>
                    <div ref={railList} className="comment-list">
                      {!allComments.length && (
                        <div className="comment-empty">
                          <MessageSquarePlus size={25} />
                          <p>
                            Select a passage in a reply, then choose{" "}
                            <strong>Comment</strong>.
                          </p>
                          <span>Or use “Comment on reply” below it.</span>
                        </div>
                      )}
                      {allComments.map((c) => {
                        const isEditing =
                          c.id === "editing" || editing?.id === c.id;
                        return (
                          <div
                            className={`comment-card ${active === c.id ? "active" : ""} ${c.status === "resolved" ? "resolved" : ""}`}
                            key={c.id}
                            data-comment-id={c.id}
                            style={{ marginTop: commentGaps[c.id] ?? 12 }}
                          >
                            <div className="comment-meta">
                              <span className="avatar">Y</span>
                              <strong>You</strong>
                              <span className="comment-state">
                                {isEditing
                                  ? "Draft"
                                  : c.status === "sent"
                                    ? "Sent"
                                    : c.status === "resolved"
                                      ? "Resolved"
                                      : "Draft"}
                              </span>
                            </div>
                            <button
                              className="comment-quote"
                              title="Jump to original passage"
                              onClick={() => jump(c)}
                            >
                              {c.anchor.quote}
                            </button>
                            {isEditing ? (
                              <>
                                <textarea
                                  aria-label="Inline comment"
                                  autoFocus
                                  rows={3}
                                  placeholder="What’s your thought?"
                                  value={editing?.text ?? ""}
                                  onChange={(e) =>
                                    setEditing((prev) =>
                                      prev
                                        ? { ...prev, text: e.target.value }
                                        : prev,
                                    )
                                  }
                                  onKeyDown={(e) => {
                                    if (
                                      (e.metaKey || e.ctrlKey) &&
                                      e.key === "Enter"
                                    ) {
                                      e.preventDefault();
                                      void saveComment();
                                    }
                                    if (e.key === "Escape") setEditing(null);
                                  }}
                                />
                                <div className="comment-actions">
                                  <button onClick={() => setEditing(null)}>
                                    Cancel
                                  </button>
                                  <button
                                    className="primary"
                                    disabled={!editing?.text.trim()}
                                    onClick={() => void saveComment()}
                                  >
                                    {editing?.id ? "Save" : "Add comment"}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="comment-text">{c.text}</p>
                                <div className="comment-actions">
                                  {c.status === "draft" ? (
                                    <>
                                      <button
                                        aria-label="Edit comment"
                                        onClick={() => {
                                          if (editing) return;
                                          setEditing({
                                            id: c.id,
                                            anchor: c.anchor,
                                            text: c.text,
                                          });
                                        }}
                                      >
                                        <Pencil size={13} />
                                      </button>
                                      <button
                                        aria-label="Delete comment"
                                        onClick={() =>
                                          void saveComments(
                                            snapshot.comments.filter(
                                              (x) => x.id !== c.id,
                                            ),
                                          ).catch(fail)
                                        }
                                      >
                                        <Trash2 size={13} />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      onClick={() =>
                                        void saveComments(
                                          snapshot.comments.map((x) =>
                                            x.id === c.id
                                              ? {
                                                  ...x,
                                                  status:
                                                    c.status === "resolved"
                                                      ? "sent"
                                                      : "resolved",
                                                }
                                              : x,
                                          ),
                                        ).catch(fail)
                                      }
                                    >
                                      <Check size={13} />
                                      {c.status === "resolved"
                                        ? "Reopen"
                                        : "Resolve"}
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </aside>
                )}
                {panel && (
                  <aside className="comment-rail">
                    <div className="rail-heading">
                      <strong>
                        {
                          browserPlugins
                            .flatMap((p) => p.panels ?? [])
                            .find((p) => panel.endsWith(`:${p.id}`))?.title
                        }
                      </strong>
                      <button
                        aria-label="Close panel"
                        onClick={() => setPanel(null)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {browserPlugins.flatMap(
                      (p) =>
                        p.panels
                          ?.filter((x) => `${p.id}:${x.id}` === panel)
                          .map((x) => {
                            const Component = x.component;
                            return (
                              <PluginBoundary key={x.id} name={p.id}>
                                <Component {...pluginContext(p.id)} />
                              </PluginBoundary>
                            );
                          }) ?? [],
                    )}
                  </aside>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
      {selection && (
        <button
          className="selection-action"
          style={{ left: selection.x, top: selection.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startComment(selection.anchor)}
        >
          <MessageSquarePlus size={15} />
          Comment
        </button>
      )}
      {projectForm && (
        <div className="modal-backdrop" onClick={() => setProjectForm(false)}>
          <form
            className="modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void addProject();
            }}
          >
            <div className="rail-heading">
              <h2>Open a project</h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setProjectForm(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p>
              Choose a local folder. Pi will use its files, skills, and project
              extensions.
            </p>
            {boot.execution?.mode === "cco" && (
              <p>
                Opening a folder here does not expand cco's write permissions.
                Add writable folders when starting the server with{" "}
                <code>--add-dir</code>.
              </p>
            )}
            <label htmlFor="folder-path">Folder path</label>
            <input
              id="folder-path"
              autoFocus
              placeholder="/Users/you/projects/my-project"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
            />
            <button
              className="primary"
              disabled={!folderPath.trim()}
              type="submit"
            >
              <FolderPlus size={15} />
              Open project
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
function modelKey(m?: ModelInfo) {
  return m ? `${m.backend ?? "pi"}:${m.provider}/${m.id}` : "";
}
function UserMessage({ text }: { text: string }) {
  if (text.startsWith("I reviewed your replies."))
    try {
      const b = JSON.parse(text.slice(text.indexOf("{"))) as {
        inlineComments: { quotedPassage: string; comment: string }[];
        overallReply: string;
      };
      return (
        <div className="user-bubble">
          {b.overallReply && <p>{b.overallReply}</p>}
          <div className="sent-batch">
            <MessageSquare size={14} />
            {b.inlineComments.length} inline comment
            {b.inlineComments.length === 1 ? "" : "s"} sent
          </div>
          <details>
            <summary>View feedback</summary>
            {b.inlineComments.map((c, i) => (
              <div className="sent-feedback" key={i}>
                <blockquote>{c.quotedPassage}</blockquote>
                <p>{c.comment}</p>
              </div>
            ))}
          </details>
        </div>
      );
    } catch {
      /* Render ordinary user text if this isn't a feedback batch. */
    }
  return (
    <div className="user-bubble">
      <Markdown text={text} />
    </div>
  );
}
