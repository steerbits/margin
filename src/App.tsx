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
  SlidersHorizontal,
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
import { ArtifactLauncher } from "./ArtifactReview.tsx";
import {
  destinationUrl,
  parseRoute,
  type AppRoute,
  type Destination,
  type CustomizeTab,
} from "../shared/navigation.ts";
import type { NavigationRequest } from "./navigation.ts";
import { defaultSkill, skillLabel } from "../shared/skills.ts";
import { ChatStatus } from "./ChatStatus.tsx";
import { ConversationMenu } from "./ConversationMenu.tsx";
import { ChatCache, ChatDrafts } from "./chat-cache.ts";
import { useUnread } from "./use-unread.ts";
import {
  AppDialog,
  WorkspacePicker,
  readRecentWorkspaces,
} from "./WorkspacePicker.tsx";
import { anchorFromRange, rangeForAnchor } from "./anchors.ts";
import { Markdown } from "./Markdown.tsx";
import { ToolCard } from "./ToolCard.tsx";
import { DialogCard } from "./DialogCard.tsx";
import { browserPlugins, loadBrowserPlugins } from "./plugins.ts";
import { CustomizeMargin } from "./CustomizeMargin.tsx";
import type { BrowserPluginContext } from "./plugin-api.ts";
import { PluginBoundary } from "./PluginBoundary.tsx";
import {
  PluginPanel,
  ConversationWorkspace,
  captureConversationPosition,
} from "./PluginPanel.tsx";
import { CustomMessage } from "./CustomMessage.tsx";
import { captureCommentPosition, focusCommentEditor } from "./comment-focus.ts";

interface Bootstrap {
  projects: Project[];
  sessions: SessionInfo[];
  models: ModelInfo[];
  modelError?: string;
  workspaceErrors?: string[];
  readOnlyAuth: boolean;
  execution?: ExecutionInfo;
  activePluginFolders?: string[];
  marginProjectId?: string;
  workspaceParent?: string;
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
    [sessionId, setSessionId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resized = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  const [hubTab, setHubTab] = useState<CustomizeTab>("examples");
  const [routeMissing, setRouteMissing] = useState(false);
  const routeRef = useRef<AppRoute>(
    parseRoute(location.pathname, location.search),
  );
  const returnRoute = useRef<Destination | null>(null);
  const historyIndex = useRef(Number(history.state?.marginIndex ?? 0));
  const restoringHistory = useRef(false);
  const [recents, setRecents] = useState(readRecentWorkspaces);
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    session: SessionInfo;
    x: number;
    y: number;
  } | null>(null);
  const histories = useRef(new ChatCache()).current;
  const pendingDrafts = useRef(
    new ChatDrafts((id, text) =>
      api(`/sessions/${id}/composer`, { text }, "PUT"),
    ),
  ).current;
  const previews = useRef(new Map<string, Promise<void>>()).current;
  const deletedSessions = useRef(new Set<string>()).current;
  const positions = useRef(
    new Map<string, { top: number; sticky: boolean }>(),
  ).current;
  const skillChoices = useRef(new Map<string, string>()).current;
  const [managing, setManaging] = useState(false);
  const [statusError, setStatusError] = useState("");
  const skillChosen = useRef(false);
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
  const [choosingWorkspace, setChoosingWorkspace] = useState(false),
    [newModel, setNewModel] = useState("");
  const [hubOpen, setHubOpen] = useState(false);
  const choosingWorkspaceRef = useRef(false);
  const [panel, setPanel] = useState<string | null>(null),
    [commentGaps, setCommentGaps] = useState<Record<string, number>>({});
  const draftRef = useRef(""),
    dirty = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    scrollRef = useRef<HTMLDivElement>(null),
    railList = useRef<HTMLDivElement>(null);
  const commentEditor = useRef<HTMLTextAreaElement>(null);
  const pendingCommentFocus = useRef<{
    id: string;
    restore: () => void;
  } | null>(null);
  const restoreConversation = useRef<(() => void) | undefined>(undefined);
  function changePanel(next: string | null) {
    if (next === panel) return;
    if (editing) {
      fail(
        new Error(
          "Finish or cancel your draft comment before changing panels.",
        ),
      );
      return;
    }
    restoreConversation.current = captureConversationPosition(
      scrollRef.current,
    );
    const route = routeRef.current;
    void flushDraft()
      .then(() => {
        if (routeRef.current !== route) return;
        setPanel(next);
        setRail(false);
        if (route.kind === "chat" || route.kind === "workspace")
          writeRoute({ ...route, panel: next ?? undefined });
      })
      .catch(fail);
  }
  useLayoutEffect(() => {
    restoreConversation.current?.();
    restoreConversation.current = undefined;
  }, [panel]);
  const stickyBottom = useRef(true),
    selectedId = useRef(sessionId),
    lastAccepted = useRef<string>("");
  const draftVersion = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const currentProject = boot.projects.find((p) => p.id === projectId);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  function writeRoute(next: Destination, replace = false) {
    const url = destinationUrl(next);
    if (location.pathname + location.search !== url) {
      if (!replace) historyIndex.current++;
      history[replace ? "replaceState" : "pushState"](
        { marginIndex: historyIndex.current },
        "",
        url,
      );
    } else history.replaceState({ marginIndex: historyIndex.current }, "", url);
    routeRef.current = next;
  }
  function applyRoute(next: AppRoute, data: Bootstrap) {
    setRenameOpen(false);
    setDeleteTarget(null);
    setContextMenu(null);
    setAllWorkspaces(false);
    routeRef.current = next;
    setRouteMissing(false);
    if (next.kind === "customize") {
      const marginProject =
        data.projects.find((p) => p.id === data.marginProjectId) ??
        data.projects.find((p) => p.kind === "margin");
      const saved =
        data.projects.find(
          (p) => p.id === localStorage.getItem("margin.project"),
        ) ?? data.projects[0];
      setProjectId(
        (current) =>
          marginProject?.id ??
          (data.projects.some((p) => p.id === current)
            ? current
            : (saved?.id ?? "")),
      );
      if (!returnRoute.current) {
        const chat = data.sessions.find(
          (s) => s.id === localStorage.getItem("margin.session"),
        );
        if (chat) returnRoute.current = { kind: "chat", sessionId: chat.id };
        else if (saved)
          returnRoute.current = { kind: "workspace", projectId: saved.id };
      }
      setHubTab(next.tab);
      setHubOpen(true);
      setPanel(null);
      setRail(false);
      return;
    }
    setHubOpen(false);
    const chat =
      next.kind === "chat"
        ? data.sessions.find((s) => s.id === next.sessionId)
        : undefined;
    const project =
      next.kind === "workspace"
        ? data.projects.find((p) => p.id === next.projectId)
        : chat
          ? data.projects.find((p) => p.id === chat.projectId)
          : undefined;
    if (!project || (next.kind === "chat" && !chat)) {
      setRouteMissing(true);
      activateSession(null);
      setPanel(null);
      setRail(false);
      return;
    }
    setProjectId(project.id);
    activateSession(chat?.id ?? null);
    const nextPanel =
      next.kind === "chat" || next.kind === "workspace"
        ? next.panel
        : undefined;
    const foundPanel =
      !nextPanel ||
      nextPanel === "comments" ||
      browserPlugins.some((p) =>
        p.panels?.some(
          (x) =>
            `${p.id}:${x.id}` === nextPanel &&
            (x.scope === "workspace" || !!chat),
        ),
      );
    setPanel(
      foundPanel && nextPanel !== "comments" ? (nextPanel ?? null) : null,
    );
    setRail(nextPanel === "comments" && !!chat);
    if (!foundPanel)
      setError(
        "This panel is unavailable. It may belong to a disabled plugin.",
      );
  }
  async function go(next: Destination, data = boot, replace = false) {
    if (managing)
      throw new Error(
        "Wait for the current change to finish before navigating.",
      );
    if (editing)
      throw new Error("Finish or cancel your draft comment before navigating.");
    if (sending)
      throw new Error("Wait for your message to be saved before navigating.");
    const save = flushDraft();
    void save.catch(fail);
    if (next.kind === "customize" && routeRef.current.kind !== "customize") {
      if (sessionId && scrollRef.current)
        positions.set(sessionId, {
          top: scrollRef.current.scrollTop,
          sticky: stickyBottom.current,
        });
      const previous = routeRef.current;
      if (previous.kind === "chat" || previous.kind === "workspace")
        returnRoute.current = previous;
    }
    setError("");
    writeRoute(next, replace);
    applyRoute(next, data);
  }
  const refresh = useCallback(async () => {
    const route = parseRoute(location.pathname, location.search);
    const query =
      route.kind === "chat"
        ? `sessionId=${encodeURIComponent(route.sessionId)}`
        : `projectId=${encodeURIComponent(route.kind === "workspace" ? route.projectId : (localStorage.getItem("margin.project") ?? ""))}`;
    const b = await api<Bootstrap>(`/bootstrap?${query}`);
    const pluginErrors = await loadBrowserPlugins(b.activePluginFolders);
    if (pluginErrors.length)
      setError(
        `Some browser plugins could not load: ${pluginErrors.join("; ")}`,
      );
    setBoot(b);
    setLoaded(true);
    let next = parseRoute(location.pathname, location.search);
    if (next.kind === "home") {
      const chat = b.sessions.find(
        (s) => s.id === localStorage.getItem("margin.session"),
      );
      const project =
        b.projects.find(
          (p) => p.id === localStorage.getItem("margin.project"),
        ) ?? b.projects[0];
      if (chat) next = { kind: "chat", sessionId: chat.id };
      else if (project) next = { kind: "workspace", projectId: project.id };
    }
    if (next.kind !== "home" && next.kind !== "not-found")
      writeRoute(next, true);
    applyRoute(next, b);
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
    if (projectId) {
      localStorage.setItem("margin.project", projectId);
      const next = [
        projectId,
        ...readRecentWorkspaces().filter((id) => id !== projectId),
      ];
      localStorage.setItem("margin.recent-workspaces", JSON.stringify(next));
      setRecents(next);
    }
  }, [projectId]);
  function activateSession(id: string | null) {
    if (selectedId.current === id) return;
    const previous = selectedId.current;
    if (previous && snapshotRef.current?.session.id === previous) {
      histories.put({ ...snapshotRef.current, composer: draftRef.current });
      positions.set(previous, {
        top: scrollRef.current?.scrollTop ?? 0,
        sticky: stickyBottom.current,
      });
    }
    selectedId.current = id;
    const cached = id ? histories.get(id) : undefined;
    const pending = id ? pendingDrafts.get(id) : undefined;
    setSnapshot(cached ?? null);
    snapshotRef.current = cached ?? null;
    setSessionId(id);
    setConnected(false);
    setEditing(null);
    setSelection(null);
    setActive(null);
    setCommentGaps({});
    const text = id
      ? pendingDrafts.text(id, cached?.composer ?? "", cached?.composerRevision)
      : "";
    setDraft(text);
    draftRef.current = text;
    dirty.current = !!pending;
    setSkill(id ? (skillChoices.get(id) ?? "") : "");
    skillChosen.current = !!id && skillChoices.has(id);
    stickyBottom.current = id ? (positions.get(id)?.sticky ?? true) : true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }
  function prefetchSession(id: string) {
    if (deletedSessions.has(id)) return Promise.resolve();
    if (previews.has(id)) return previews.get(id)!;
    const previous = histories.get(id);
    const request = api<Snapshot>(`/sessions/${id}/preview`)
      .then((preview) => {
        // A later live event always wins over an earlier preview request.
        if (deletedSessions.has(id) || histories.get(id) !== previous) return;
        histories.put(preview);
        if (selectedId.current === id && !snapshotRef.current) {
          setSnapshot(preview);
          snapshotRef.current = preview;
          const text = pendingDrafts.text(
            id,
            preview.composer,
            preview.composerRevision,
          );
          setDraft(text);
          draftRef.current = text;
        }
      })
      .catch(() => {
        /* The live connection reports errors; speculative reads do not interrupt navigation. */
      })
      .finally(() => previews.delete(id));
    previews.set(id, request);
    return request;
  }
  const previewCandidates = boot.sessions
    .filter((s) => s.projectId === projectId)
    .slice(0, 5);
  const previewKey = previewCandidates
    .map((s) => `${s.id}:${s.updatedAt}`)
    .join(",");
  useEffect(() => {
    if (!loaded) return;
    for (const session of previewCandidates)
      if (!histories.get(session.id)) void prefetchSession(session.id);
  }, [loaded, projectId, previewKey]);
  useLayoutEffect(() => {
    const saved = sessionId ? positions.get(sessionId) : undefined;
    if (scrollRef.current && snapshot?.session.id === sessionId)
      scrollRef.current.scrollTop =
        saved && !saved.sticky ? saved.top : scrollRef.current.scrollHeight;
  }, [sessionId, hubOpen, snapshot?.session.id]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!pendingDrafts.unsaved) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    if (!sessionId) {
      if (!hubOpen) localStorage.removeItem("margin.session");
      return;
    }
    localStorage.setItem("margin.session", sessionId);
    if (!histories.get(sessionId)) void prefetchSession(sessionId);
    let closed = false;
    const stream = new EventSource(`/api/sessions/${sessionId}/events`);
    stream.onerror = () => {
      if (!closed) setConnected(false);
    };
    stream.onmessage = (e) => {
      if (closed || deletedSessions.has(sessionId)) return;
      const { snapshot: s } = JSON.parse(e.data) as { snapshot: Snapshot };
      histories.put(s);
      if (selectedId.current !== s.session.id) return;
      setConnected(true);
      setSnapshot(s);
      snapshotRef.current = s;
      if (!s.busy && !skillChosen.current) {
        const choice = s.messages.some((m) => m.role === "user")
          ? ""
          : defaultSkill(s.skills);
        setSkill(choice);
        skillChoices.set(s.session.id, choice);
        skillChosen.current = true;
      } else
        setSkill((current) =>
          s.skills.some((x) => x.name === current) ? current : "",
        );
      const pending = pendingDrafts.get(s.session.id);
      const text = pendingDrafts.text(
        s.session.id,
        s.composer,
        s.composerRevision,
      );
      setDraft(text);
      draftRef.current = text;
      dirty.current = !!pending;
      setBoot((b) => ({
        ...b,
        sessions: [
          s.session,
          ...b.sessions.filter((x) => x.id !== s.session.id),
        ],
      }));
    };
    return () => {
      closed = true;
      stream.close();
    };
  }, [sessionId, loaded]);
  const navigationHandler = useRef<
    (next: AppRoute, index?: number) => Promise<void>
  >(async () => {});
  navigationHandler.current = async (next, index) => {
    if (index === undefined) {
      if (next.kind === "home" || next.kind === "not-found")
        throw new Error("Unknown destination.");
      return go(next);
    }
    try {
      if (editing || sending || managing)
        throw new Error(
          "Finish or cancel your draft comment, and wait for sending to finish before navigating.",
        );
      void flushDraft().catch(fail);
      historyIndex.current = index;
      setError("");
      if (next.kind === "home")
        next = {
          kind: "workspace",
          projectId: projectId || boot.projects[0]?.id || "",
        };
      applyRoute(next, boot);
    } catch (error) {
      restoringHistory.current = true;
      history.go(historyIndex.current - index);
      fail(error);
    }
  };
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (restoringHistory.current) {
        restoringHistory.current = false;
        return;
      }
      void navigationHandler.current(
        parseRoute(location.pathname, location.search),
        Number(event.state?.marginIndex ?? 0),
      );
    };
    const plugin = (event: Event) => {
      event.preventDefault();
      const { destination, resolve, reject } = (
        event as CustomEvent<NavigationRequest>
      ).detail;
      void navigationHandler.current(destination).then(resolve, reject);
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("margin:navigate", plugin);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("margin:navigate", plugin);
    };
  }, []);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await api<{
          sessions: SessionInfo[];
          workspaceErrors?: string[];
        }>("/sessions");
        if (!cancelled) {
          setBoot((b) => ({
            ...b,
            sessions: result.sessions.filter((s) => !deletedSessions.has(s.id)),
            workspaceErrors: result.workspaceErrors ?? b.workspaceErrors,
          }));
          setStatusError("");
        }
      } catch {
        if (!cancelled)
          setStatusError("Chat status updates are unavailable. Retrying…");
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loaded]);
  useEffect(() => {
    if (stickyBottom.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    snapshot?.messages.length,
    snapshot?.messages.at(-1)?.text,
    snapshot?.dialogs.length,
  ]);
  function updateDraft(text: string) {
    updateChatDraft(sessionId, text);
  }
  function updateChatDraft(id: string | null, text: string) {
    if (id && deletedSessions.has(id)) return;
    if (id) pendingDrafts.set(id, text);
    if (selectedId.current !== id) {
      if (id) void pendingDrafts.flush(id).catch(fail);
      return;
    }
    setDraft(text);
    draftRef.current = text;
    dirty.current = true;
    const version = ++draftVersion.current;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (id) {
      saveTimer.current = setTimeout(
        () => void persistDraft(id, text, version).catch(fail),
        250,
      );
    }
  }
  async function persistDraft(id: string, _text: string, _version: number) {
    await pendingDrafts.flush(id);
    if (selectedId.current === id && !pendingDrafts.get(id))
      dirty.current = false;
  }
  async function flushDraft() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (sessionId) await pendingDrafts.flush(sessionId);
  }
  function workspacePanel() {
    return browserPlugins.some((p) =>
      p.panels?.some(
        (x) => `${p.id}:${x.id}` === panel && x.scope === "workspace",
      ),
    )
      ? (panel ?? undefined)
      : undefined;
  }
  async function switchSession(id: string | null) {
    try {
      await go(
        id
          ? { kind: "chat", sessionId: id, panel: workspacePanel() }
          : { kind: "workspace", projectId, panel: workspacePanel() },
      );
    } catch (error) {
      fail(error);
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
      histories.put(s);
      const data = { ...boot, sessions: [s.session, ...boot.sessions] };
      setBoot(data);
      writeRoute({
        kind: "chat",
        sessionId: s.session.id,
        panel: workspacePanel(),
      });
      applyRoute(routeRef.current, data);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setSending(false);
    }
  }
  async function openCustomization() {
    await go({ kind: "customize", tab: "examples" });
    if (window.innerWidth <= 650) setSidebar(false);
  }
  async function customizationPrompt(project: Project, prompt: string) {
    await flushDraft();
    const s = await api<Snapshot>("/sessions", {
      projectId: project.id,
      model: boot.models.find((m) => modelKey(m) === newModel),
    });
    if (prompt)
      await api(`/sessions/${s.session.id}/composer`, { text: prompt }, "PUT");
    histories.put({ ...s, composer: prompt });
    const data = { ...boot, sessions: [s.session, ...boot.sessions] };
    setBoot(data);
    await go({ kind: "chat", sessionId: s.session.id }, data);
  }
  async function chooseWorkspace() {
    if (choosingWorkspaceRef.current) return;
    if (editing) {
      setError("Finish or cancel your comment before changing workspaces.");
      return;
    }
    choosingWorkspaceRef.current = true;
    setChoosingWorkspace(true);
    setError("");
    try {
      await flushDraft();
      const { project } = await api<{ project: Project | null }>(
        "/workspaces/choose",
        {},
      );
      if (project) await openProject(project);
    } catch (e) {
      fail(e);
    } finally {
      choosingWorkspaceRef.current = false;
      setChoosingWorkspace(false);
    }
  }
  async function openProject(p: Project) {
    const data = {
      ...boot,
      projects: boot.projects.some((x) => x.id === p.id)
        ? boot.projects
        : [...boot.projects, p],
    };
    await go(
      { kind: "workspace", projectId: p.id, panel: workspacePanel() },
      data,
    );
    setBoot(data);
    setAllWorkspaces(false);
  }
  async function saveComments(comments: Comment[]) {
    const id = sessionId!;
    await api(`/sessions/${id}/comments`, comments, "PUT");
    const cached = histories.get(id);
    if (cached && !deletedSessions.has(id))
      histories.put({ ...cached, comments });
    setSnapshot((s) => (s?.session.id === id ? { ...s, comments } : s));
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
    if (
      !snapshot ||
      !connected ||
      sending ||
      editing ||
      snapshot.busy ||
      snapshot.dialogs.length
    )
      return;
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
        if (sendingSession) skillChoices.set(sendingSession, "");
        skillChosen.current = true;
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
    pendingCommentFocus.current = {
      id: "editing",
      restore: captureCommentPosition(scrollRef.current, anchor),
    };
    setEditing({ anchor, text: "" });
    setActive("editing");
    setRail(true);
    setPanel(null);
    if (routeRef.current.kind === "chat")
      writeRoute({ ...routeRef.current, panel: "comments" }, true);
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
    const route = routeRef.current;
    if (route.kind === "chat")
      writeRoute({ ...route, panel: open ? "comments" : undefined });
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
    if (routeRef.current.kind === "chat")
      writeRoute({ ...routeRef.current, panel: "comments" });
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
  const editingId = editing ? (editing.id ?? "editing") : null;
  useLayoutEffect(() => {
    if (!editingId) {
      pendingCommentFocus.current = null;
      return;
    }
    const request = pendingCommentFocus.current;
    if (!request || request.id !== editingId) return;
    // The margin positions are applied in a second render. Focus in the next frame,
    // cancelling/rescheduling if those positions changed before the frame runs.
    const frame = requestAnimationFrame(() => {
      if (
        pendingCommentFocus.current !== request ||
        !commentEditor.current ||
        !scrollRef.current
      )
        return;
      request.restore();
      focusCommentEditor(scrollRef.current, commentEditor.current);
      pendingCommentFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [editingId, commentGaps, rail, panel]);
  const pluginContext = (id: string): BrowserPluginContext => ({
    snapshot: snapshot!,
    state: snapshot?.pluginState[id],
    action: (name, input) =>
      api(`/sessions/${sessionId}/plugins/${id}/${name}`, input),
    setComposer: (text) => updateChatDraft(snapshot!.session.id, text),
  });
  const draftCount =
    snapshot?.comments.filter((c) => c.status === "draft").length ?? 0;
  const busy = snapshot?.busy ?? false;
  const currentActivity =
    boot.sessions.find((s) => s.id === sessionId)?.activity ??
    snapshot?.session.activity;
  const isUnread = useUnread(
    sessionId,
    currentActivity,
    !hubOpen &&
      !routeMissing &&
      !!snapshot &&
      !allWorkspaces &&
      !renameOpen &&
      !deleteTarget &&
      !contextMenu &&
      !(panel && viewportWidth <= 900) &&
      !(sidebar && viewportWidth <= 650),
    scrollRef,
    snapshot?.messages.at(-1)?.id,
  );
  const orderedProjects = [
    ...recents
      .map((id) => boot.projects.find((p) => p.id === id))
      .filter((p): p is Project => !!p),
    ...boot.projects.filter((p) => !recents.includes(p.id)),
  ];
  const recentProjects = (
    currentProject
      ? [
          currentProject,
          ...orderedProjects.filter((p) => p.id !== currentProject.id),
        ]
      : orderedProjects
  ).slice(0, 5);
  function sessionActive(info: SessionInfo) {
    if (snapshot?.session.id === info.id && connected)
      return snapshot.busy || snapshot.dialogs.length > 0;
    return ["running", "waiting"].includes(
      boot.sessions.find((s) => s.id === info.id)?.activity?.status ??
        info.activity?.status ??
        "idle",
    );
  }
  const model = snapshot?.session.model;
  const agentName = snapshot?.session.backendLabel ?? "Pi";
  return (
    <div className={`app ${sidebar ? "" : "sidebar-hidden"}`}>
      {contextMenu && (
        <ConversationMenu
          {...contextMenu}
          active={sessionActive(contextMenu.session)}
          onClose={() => setContextMenu(null)}
          onStop={() => {
            const id = contextMenu.session.id;
            setContextMenu(null);
            void api(`/sessions/${id}/stop`, {}).catch(fail);
          }}
          onDelete={() => {
            setError("");
            setDeleteTarget(contextMenu.session);
            setContextMenu(null);
          }}
        />
      )}
      {allWorkspaces && (
        <WorkspacePicker
          projects={orderedProjects}
          current={projectId}
          onClose={() => setAllWorkspaces(false)}
          onSelect={(project) => void openProject(project).catch(fail)}
        />
      )}
      {renameOpen && (
        <AppDialog
          title="Rename workspace"
          onClose={() => {
            if (!managing) setRenameOpen(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setManaging(true);
              void api<Project>(
                `/projects/${projectId}`,
                { name: workspaceName.trim() },
                "PATCH",
              )
                .then((project) => {
                  setBoot((b) => ({
                    ...b,
                    projects: b.projects.map((p) =>
                      p.id === project.id ? project : p,
                    ),
                  }));
                  setRenameOpen(false);
                })
                .catch(fail)
                .finally(() => setManaging(false));
            }}
          >
            <label>
              Workspace name
              <input
                autoFocus
                value={workspaceName}
                maxLength={100}
                onChange={(event) => setWorkspaceName(event.target.value)}
              />
            </label>
            <p className="muted">Folder: {currentProject?.path}</p>
            <div className="management-actions">
              <button
                type="button"
                disabled={managing}
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={managing || !workspaceName.trim()}
              >
                Save name
              </button>
            </div>
          </form>
        </AppDialog>
      )}
      {deleteTarget && (
        <AppDialog
          title="Delete conversation?"
          onClose={() => {
            if (!managing) setDeleteTarget(null);
          }}
        >
          <p>
            Permanently delete “{deleteTarget.title}”, its messages, comments,
            and draft? This cannot be undone.
          </p>
          <p className="muted">
            Workspace files and shared plugin data are kept.
          </p>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="management-actions">
            <button disabled={managing} onClick={() => setDeleteTarget(null)}>
              Cancel
            </button>
            <button
              className="danger"
              disabled={managing || sessionActive(deleteTarget)}
              onClick={() => {
                const target = deleteTarget;
                if (selectedId.current === target.id && editing) {
                  fail(
                    new Error(
                      "Finish or cancel your draft comment before deleting this conversation.",
                    ),
                  );
                  return;
                }
                setManaging(true);
                if (selectedId.current === target.id && saveTimer.current)
                  clearTimeout(saveTimer.current);
                void pendingDrafts
                  .flush(target.id)
                  .then(() => api(`/sessions/${target.id}`, {}, "DELETE"))
                  .then(() => {
                    deletedSessions.add(target.id);
                    histories.delete(target.id);
                    pendingDrafts.delete(target.id);
                    positions.delete(target.id);
                    skillChoices.delete(target.id);
                    const data = {
                      ...boot,
                      sessions: boot.sessions.filter((s) => s.id !== target.id),
                    };
                    setBoot(data);
                    if (selectedId.current === target.id) {
                      snapshotRef.current = null;
                      const next: Destination = {
                        kind: "workspace",
                        projectId: target.projectId,
                        panel: workspacePanel(),
                      };
                      writeRoute(next, true);
                      applyRoute(next, data);
                    }
                    setDeleteTarget(null);
                  })
                  .catch(fail)
                  .finally(() => setManaging(false));
              }}
            >
              Delete permanently
            </button>
          </div>
        </AppDialog>
      )}
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
              boot.execution?.mode === "cco-workspaces"
                ? "Each workspace runs its own Pi server inside cco defaults."
                : boot.execution?.mode === "cco"
                  ? `Whole server launched through cco defaults. Writable application paths: ${boot.execution.writablePaths.join(", ")}. cco also permits its normal state and temporary paths.`
                  : "This server was started directly, without the cco wrapper."
            }
          >
            {boot.execution?.mode === "cco-workspaces"
              ? "cco · per workspace"
              : boot.execution?.mode === "cco"
                ? "cco sandbox"
                : "Native"}
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
          <button
            className="customize-entry"
            aria-pressed={hubOpen}
            onClick={() => void openCustomization().catch(fail)}
          >
            <SlidersHorizontal size={17} />
            Customize Margin
          </button>
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
              aria-label="Rename workspace"
              title="Rename workspace"
              disabled={!currentProject}
              onClick={() => {
                setWorkspaceName(currentProject?.name ?? "");
                setRenameOpen(true);
              }}
            >
              <Pencil size={16} />
            </button>
            <button
              aria-label="New workspace"
              title="Open or create a workspace"
              disabled={choosingWorkspace}
              aria-busy={choosingWorkspace}
              onClick={() => void chooseWorkspace()}
            >
              <FolderPlus size={16} />
            </button>
          </div>
          <select
            className="project-select"
            aria-label="Project"
            disabled={!loaded}
            value={projectId}
            onChange={(e) => {
              if (editing) {
                setError("Finish or cancel your draft comment first.");
                return;
              }
              if (e.target.value === "__all__") {
                setAllWorkspaces(true);
                return;
              }
              const project = boot.projects.find(
                (p) => p.id === e.target.value,
              );
              if (project) void openProject(project).catch(fail);
            }}
          >
            {recentProjects.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name}
              </option>
            ))}
            <hr />
            <option value="__all__">All workspaces…</option>
          </select>
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
                  data-session-id={s.id}
                  onClick={() => void switchSession(s.id)}
                  onMouseEnter={() => {
                    if (!histories.get(s.id)) void prefetchSession(s.id);
                  }}
                  onFocus={() => {
                    if (!histories.get(s.id)) void prefetchSession(s.id);
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({
                      session: s,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "ContextMenu" ||
                      (event.shiftKey && event.key === "F10")
                    ) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setContextMenu({
                        session: s,
                        x: rect.left + 20,
                        y: rect.bottom,
                      });
                    }
                  }}
                  aria-haspopup="menu"
                  title={s.title}
                >
                  <span className="session-title">{s.title}</span>
                  {s.activity?.status === "running" ? (
                    <span
                      className="conversation-spinner"
                      role="img"
                      aria-label="Running"
                      title="Running"
                    />
                  ) : isUnread(s.id, s.activity) ? (
                    <span
                      className="conversation-unread"
                      role="img"
                      aria-label="Unread"
                      title="Unread"
                    />
                  ) : null}
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
          {statusError && (
            <div className="notice" role="status">
              {statusError}
            </div>
          )}
          {error && (
            <div className="notice error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {choosingWorkspace && (
            <div className="notice" role="status">
              Choose or create a folder in the system dialog.
            </div>
          )}
          {routeMissing ? (
            <div className="empty-state">
              <h2>Destination unavailable</h2>
              <p>
                This conversation or workspace may have been deleted or its
                folder is unavailable.
              </p>
              <button onClick={() => setAllWorkspaces(true)}>
                Choose a workspace
              </button>
            </div>
          ) : hubOpen ? (
            <CustomizeMargin
              tab={hubTab}
              onTabChange={(tab) =>
                void go({ kind: "customize", tab }).catch(fail)
              }
              onClose={() =>
                void go(
                  returnRoute.current ?? {
                    kind: "workspace",
                    projectId: projectId || boot.projects[0]?.id || "",
                  },
                ).catch(fail)
              }
              onPrompt={customizationPrompt}
            />
          ) : (
            <>
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
                  <span
                    className="project-breadcrumb"
                    title={currentProject?.path}
                  >
                    {currentProject?.name ?? "Workspace"}
                  </span>
                  <span className="crumb-separator">/</span>
                  <span className="conversation-title">
                    {snapshot?.session.title ??
                      boot.sessions.find((s) => s.id === sessionId)?.title ??
                      "New conversation"}
                  </span>
                </div>
                <div className="toolbar-actions">
                  {sessionId && (
                    <ArtifactLauncher
                      key={sessionId}
                      sessionId={sessionId}
                      onSent={() => {
                        stickyBottom.current = true;
                        requestAnimationFrame(() => {
                          if (scrollRef.current)
                            scrollRef.current.scrollTop =
                              scrollRef.current.scrollHeight;
                        });
                      }}
                    />
                  )}
                  {sessionId && (
                    <>
                      <ChatStatus
                        activity={currentActivity}
                        unread={isUnread(sessionId, currentActivity)}
                        agent={agentName}
                      />
                    </>
                  )}
                  {browserPlugins.flatMap(
                    (p) =>
                      p.panels?.map((x) => (
                        <button
                          key={`${p.id}:${x.id}`}
                          disabled={
                            x.scope === "workspace"
                              ? !currentProject
                              : !snapshot
                          }
                          aria-controls="plugin-panel"
                          aria-expanded={panel === `${p.id}:${x.id}`}
                          className={
                            panel === `${p.id}:${x.id}` ? "active-button" : ""
                          }
                          onClick={() => {
                            changePanel(
                              panel === `${p.id}:${x.id}`
                                ? null
                                : `${p.id}:${x.id}`,
                            );
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
              {sessionId && (
                <div className="mobile-chat-status">
                  <ChatStatus
                    activity={currentActivity}
                    unread={isUnread(sessionId, currentActivity)}
                    agent={agentName}
                  />
                </div>
              )}
              {!!boot.workspaceErrors?.length && (
                <div className="notice error" role="alert">
                  <span>
                    Some workspace data is unavailable:{" "}
                    {boot.workspaceErrors.join("; ")}
                  </span>
                  <button onClick={() => void refresh().catch(fail)}>
                    Retry
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
              <ConversationWorkspace
                scrollRef={scrollRef}
                panel={
                  panel &&
                  browserPlugins.flatMap(
                    (p) =>
                      p.panels
                        ?.filter(
                          (x) =>
                            `${p.id}:${x.id}` === panel &&
                            (x.scope === "workspace"
                              ? !!currentProject
                              : !!snapshot),
                        )
                        .map((x) => {
                          const content =
                            x.scope === "workspace"
                              ? (() => {
                                  const Component = x.component;
                                  const project = currentProject!;
                                  return (
                                    <Component
                                      project={project}
                                      sessionId={sessionId ?? undefined}
                                      action={(name, input) =>
                                        api(
                                          `/projects/${project.id}/plugins/${p.id}/${name}`,
                                          input,
                                        )
                                      }
                                    />
                                  );
                                })()
                              : (() => {
                                  const Component = x.component;
                                  return <Component {...pluginContext(p.id)} />;
                                })();
                          return (
                            <PluginPanel
                              key={`${p.id}:${x.id}`}
                              title={x.title}
                              onClose={() => changePanel(null)}
                            >
                              <PluginBoundary name={p.id}>
                                {content}
                              </PluginBoundary>
                            </PluginPanel>
                          );
                        }) ?? [],
                  )
                }
                onScroll={() => {
                  const e = scrollRef.current!;
                  stickyBottom.current =
                    e.scrollHeight - e.scrollTop - e.clientHeight < 90;
                  if (window.getSelection()?.isCollapsed) setSelection(null);
                  else captureSelection();
                }}
              >
                {!snapshot && sessionId ? (
                  <div
                    className="conversation-loading"
                    role="status"
                    aria-label="Loading conversation"
                  >
                    <div />
                    <div />
                    <div />
                  </div>
                ) : !snapshot ? (
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
                        Sign in through <code>pi</code> → <code>/login</code>,
                        then{" "}
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
                  <div className={`review ${rail ? "with-rail" : ""}`}>
                    <div className="thread">
                      <div className="conversation-date">
                        {new Date(
                          snapshot.session.createdAt,
                        ).toLocaleDateString(undefined, {
                          month: "long",
                          day: "numeric",
                        })}
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
                                  <span className="agent-model">
                                    {model?.name}
                                  </span>
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
                                  onMouseUp={() =>
                                    setTimeout(captureSelection, 0)
                                  }
                                  onKeyUp={captureSelection}
                                  onClick={(e) => {
                                    if (window.getSelection()?.toString())
                                      return;
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
                                  <Markdown
                                    text={m.text}
                                    artifactSessionId={snapshot.session.id}
                                  />
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
                                          const a = anchorFromRange(
                                            root,
                                            r,
                                            m.id,
                                          );
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
                              <div className="user-message-content">
                                {m.skill && (
                                  <div className="skill-used">
                                    <BookOpen size={12} />
                                    {skillLabel(m.skill)}
                                  </div>
                                )}
                                <UserMessage text={m.text} />
                              </div>
                            )}
                            {m.role === "assistant" && !m.streaming && (
                              <span
                                className="reply-end"
                                data-reply-end={m.id}
                                aria-hidden="true"
                              />
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
                            {draftCount} draft comment
                            {draftCount === 1 ? "" : "s"} attached
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
                                onChange={(e) => {
                                  skillChosen.current = true;
                                  setSkill(e.target.value);
                                  if (sessionId)
                                    skillChoices.set(sessionId, e.target.value);
                                }}
                                disabled={busy || !connected}
                              >
                                <option value="">No skill</option>
                                {snapshot.skills.map((s) => (
                                  <option key={s.filePath} value={s.name}>
                                    {skillLabel(s.name)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <button
                              type="button"
                              aria-label="Reload skills"
                              title="Reload Pi skills and extensions"
                              disabled={busy || !connected}
                              onClick={() =>
                                void api(
                                  `/sessions/${sessionId}/reload`,
                                  {},
                                ).catch(fail)
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
                                void api(
                                  `/sessions/${sessionId}/stop`,
                                  {},
                                ).catch(fail)
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
                                !!snapshot.dialogs.length ||
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
                              ? `${skillLabel(skill)} will guide your next message`
                              : "Your skill sets the pace. Your comments shape the work."}
                        </span>
                        <kbd>⌘ ↵</kbd>
                      </div>
                      {model && (
                        <div className="model-footer">
                          <span className="model-dot" />
                          <select
                            aria-label="Model"
                            disabled={busy || !connected}
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
                            {model.provider === "openai-codex" &&
                            model.subscription
                              ? "ChatGPT subscription"
                              : model.provider === "anthropic" &&
                                  model.subscription
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
                                      ref={commentEditor}
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
                                        if (e.key === "Escape")
                                          setEditing(null);
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
                                              pendingCommentFocus.current = {
                                                id: c.id,
                                                restore: captureCommentPosition(
                                                  scrollRef.current,
                                                  c.anchor,
                                                ),
                                              };
                                              stickyBottom.current = false;
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
                  </div>
                )}
              </ConversationWorkspace>
            </>
          )}
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
    </div>
  );
}
function modelKey(m?: ModelInfo) {
  return m ? `${m.backend ?? "pi"}:${m.provider}/${m.id}` : "";
}
function UserMessage({ text }: { text: string }) {
  if (text.startsWith("I reviewed the generated artifacts in Margin.")) {
    try {
      const b = JSON.parse(text.slice(text.indexOf("{"))) as {
        overallReply?: string;
        artifactComments: {
          artifact: { title: string; location: string };
          target: { route: string; quote: string };
          comment: string;
        }[];
      };
      return (
        <div className="user-bubble">
          <div className="sent-batch">
            <MessageSquare size={14} />
            {b.artifactComments.length
              ? `${b.artifactComments.length} artifact comment${b.artifactComments.length === 1 ? "" : "s"} sent`
              : "Overall feedback sent"}
          </div>
          {b.overallReply && <p>{b.overallReply}</p>}
          {b.artifactComments.length > 0 && (
            <details>
              <summary>View artifact feedback</summary>
              {b.artifactComments.map((c, i) => (
                <div className="sent-feedback" key={i}>
                  <strong>{c.artifact.title}</strong>
                  <p className="small muted">
                    {c.artifact.location} · {c.target.route}
                  </p>
                  <blockquote>{c.target.quote}</blockquote>
                  <p>{c.comment}</p>
                </div>
              ))}
            </details>
          )}
        </div>
      );
    } catch {
      /* Retain readable raw feedback from future/unknown payload versions. */
    }
  }
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
