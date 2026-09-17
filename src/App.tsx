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
  CircleHelp,
  LoaderCircle,
  Folder,
  FolderPlus,
  MessageSquare,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  Square,
  Terminal,
  Trash2,
  X,
  Pencil,
  Plug,
  CornerDownRight,
  SlidersHorizontal,
  Settings,
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
import { submitOnEnter } from "./submit-on-enter.ts";
import { marginHelpPrompt, marginIssuesUrl } from "../shared/help.ts";
import { connectConversation } from "./conversation-connection.ts";
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
import { SidebarConversations } from "./SidebarConversations.tsx";
import { SettingsDialog } from "./SettingsDialog.tsx";
import { Home } from "./Home.tsx";
import { WorkspaceHome } from "./WorkspaceHome.tsx";
import { LeaveGuard, sameInstructionsSurface } from "./leave-guard.ts";
import { ModelOptions } from "./ModelOptions.tsx";
import { configureModelLabel, modelLabel } from "../shared/model-picker.ts";
import { thinkingChoiceLabel, thinkingDefaultLabel } from "../shared/model-capabilities.ts";
import { ChatCache, ChatDrafts } from "./chat-cache.ts";
import { ChatOutbox } from "./chat-outbox.ts";
import {
  appendReplyAction,
  replyActionMessageId,
} from "../shared/reply-actions.ts";
import { useUnread } from "./use-unread.ts";
import { useSourceSend } from "./use-source-send.ts";
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
import { useChatAttachments, SentAttachments } from "./Attachments.tsx";
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const refreshing = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resized = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", resized);
    return () => window.removeEventListener("resize", resized);
  }, []);
  const [hubTab, setHubTab] = useState<CustomizeTab>("examples");
  const [routeMissing, setRouteMissing] = useState(false);
  const [homeOpen, setHomeOpen] = useState(() => location.pathname === "/");
  const routeRef = useRef<AppRoute>(
    parseRoute(location.pathname, location.search),
  );
  const returnRoute = useRef<Destination | null>(null);
  const customizePreviousProject = useRef<string | null>(null);
  const historyIndex = useRef(Number(history.state?.marginIndex ?? 0));
  const restoringHistory = useRef(false);
  const historyRestored = useRef<(() => void) | null>(null);
  const approvedHistory = useRef<number | null>(null);
  const instructionsGuard = useRef(new LeaveGuard()).current;
  const [workspaceHomeOpen, setWorkspaceHomeOpen] = useState(false);
  const [recents, setRecents] = useState(readRecentWorkspaces);
  const [allWorkspaces, setAllWorkspaces] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openingHelp, setOpeningHelp] = useState(false);
  const helpOpening = useRef(false);
  const [helpError, setHelpError] = useState("");
  const savingComment = useRef(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    session: SessionInfo;
    x: number;
    y: number;
  } | null>(null);
  const histories = useRef(new ChatCache()).current;
  const outbox = useRef(new ChatOutbox()).current;
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
    [sidebar, setSidebar] = useState(() => {
      if (window.innerWidth <= 650) return false;
      const saved = localStorage.getItem("margin.sidebar");
      return saved
        ? saved === "open"
        : location.pathname !== "/" || !!localStorage.getItem("margin.project");
    });
  const workspaceOpened = useRef(
    localStorage.getItem("margin.workspace-opened") === "true" ||
      !!localStorage.getItem("margin.project"),
  );
  function enterWorkspace() {
    if (!workspaceOpened.current) {
      workspaceOpened.current = true;
      localStorage.setItem("margin.workspace-opened", "true");
      if (localStorage.getItem("margin.sidebar") === null)
        setSidebar(window.innerWidth > 650);
    }
  }
  function toggleSidebar() {
    const open = !sidebar;
    setSidebar(open);
    localStorage.setItem("margin.sidebar", open ? "open" : "closed");
  }
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
  const unavailableNewModel =
    !!newModel && !boot.models.some((m) => modelKey(m) === newModel);
  const [hubOpen, setHubOpen] = useState(false);
  const choosingWorkspaceRef = useRef(false);
  const [panel, setPanel] = useState<string | null>(null),
    [commentGaps, setCommentGaps] = useState<Record<string, number>>({});
  const draftRef = useRef(""),
    dirty = useRef(false),
    saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    scrollRef = useRef<HTMLDivElement>(null),
    railList = useRef<HTMLDivElement>(null);
  const composerEditor = useRef<HTMLTextAreaElement>(null);
  const [pendingComposerFocus, setPendingComposerFocus] = useState<string | null>(
    null,
  );
  const [commentReveal, setCommentReveal] = useState<{
    sessionId: string;
    commentId: string | null;
  } | null>(null);
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
  const isMarginWorkspace =
    projectId === boot.marginProjectId || currentProject?.kind === "margin";
  const sourceSend = useSourceSend(isMarginWorkspace ? sessionId : null);
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  const attachments = useChatAttachments(
    sessionId,
    snapshot,
    !!snapshot?.attachmentSupport &&
      snapshot.session.id === sessionId &&
      // Uploads use ordinary HTTP, not the live-update stream. In particular,
      // returning from the OS file picker can trigger a temporary SSE reconnect.
      !sending && !outbox.get(sessionId) && !homeOpen && !hubOpen && !allWorkspaces && !routeMissing &&
      !settingsOpen && !renameOpen && !deleteTarget && !choosingWorkspace,
    fail,
    composerEditor,
  );
  function writeRoute(next: Destination, replace = false) {
    const url = destinationUrl(next);
    const moving = location.pathname + location.search !== url;
    if (moving && !replace) historyIndex.current++;
    const savedReturn = returnRoute.current
      ? destinationUrl(returnRoute.current)
      : !moving && typeof history.state?.marginReturn === "string"
        ? history.state.marginReturn
        : undefined;
    const state = {
      marginIndex: historyIndex.current,
      ...(next.kind === "customize" && savedReturn ? { marginReturn: savedReturn } : {}),
    };
    history[moving && !replace ? "pushState" : "replaceState"](state, "", url);
    routeRef.current = next;
  }
  function applyRoute(
    next: AppRoute,
    data: Bootstrap,
    previousRoute = routeRef.current,
  ) {
    setPendingComposerFocus(null);
    setCommentReveal(null);
    setRenameOpen(false);
    setDeleteTarget(null);
    setContextMenu(null);
    setAllWorkspaces(false);
    routeRef.current = next;
    setRouteMissing(false);
    setHomeOpen(next.kind === "home");
    setWorkspaceHomeOpen(next.kind === "workspace" && next.view !== "new");
    if (next.kind === "home") {
      setHubOpen(false);
      const beforeCustomize = previousRoute.kind === "customize"
        ? customizePreviousProject.current
        : null;
      setProjectId((current) => {
        if (beforeCustomize !== null)
          return data.projects.some((project) => project.id === beforeCustomize)
            ? beforeCustomize
            : "";
        if (data.projects.some((project) => project.id === current)) return current;
        const saved = localStorage.getItem("margin.project");
        return data.projects.find((project) => project.id === saved)?.id ?? "";
      });
      activateSession(null);
      setPanel(null);
      setRail(false);
      return;
    }
    if (next.kind === "customize") {
      // Keep the invoking workspace/chat with this history entry, including a
      // reload or a later Back traversal to an earlier Customize visit.
      if (typeof history.state?.marginReturn === "string") {
        try {
          const saved = new URL(history.state.marginReturn, location.origin);
          const destination = parseRoute(saved.pathname, saved.search);
          if (destination.kind !== "not-found" && destination.kind !== "customize")
            returnRoute.current = destination;
        } catch { /* Ignore malformed browser history metadata. */ }
      }
      if (previousRoute.kind !== "customize" || customizePreviousProject.current === null)
        customizePreviousProject.current =
          projectId || localStorage.getItem("margin.project") || "";
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
    enterWorkspace();
    activateSession(chat?.id ?? null);
    setPendingComposerFocus(chat?.id ?? null);
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
    if (instructionsGuard.blocking && !sameInstructionsSurface(routeRef.current, next)) {
      setAllWorkspaces(false);
      setContextMenu(null);
      if (!(await instructionsGuard.confirmLeave())) return;
    }
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
      if (previous.kind !== "not-found")
        returnRoute.current = previous;
    }
    setError("");
    const previousRoute = routeRef.current;
    writeRoute(next, replace);
    applyRoute(next, data, previousRoute);
  }
  const refresh = useCallback(async () => {
    // Keep retries (and StrictMode's initial effect) single-flight.
    if (refreshing.current) return;
    refreshing.current = true;
    setLoading(true);
    setLoadError("");
    try {
      const route = parseRoute(location.pathname, location.search);
      const query =
        route.kind === "chat"
          ? `sessionId=${encodeURIComponent(route.sessionId)}`
          : `projectId=${encodeURIComponent(route.kind === "workspace" ? route.projectId : (localStorage.getItem("margin.project") ?? ""))}`;
      // Allow the gateway's 35s worker-start budget, but not an endless spinner.
      const b = await api<Bootstrap>(
        `/bootstrap?${query}`, undefined, "GET", AbortSignal.timeout(45000),
      );
      const pluginErrors = await loadBrowserPlugins(b.activePluginFolders);
      if (pluginErrors.length)
        setError(
          `Some browser plugins could not load: ${pluginErrors.join("; ")}`,
        );
      setBoot(b);
      const next = parseRoute(location.pathname, location.search);
      if (next.kind !== "not-found")
        writeRoute(next, true);
      applyRoute(next, b);
      setLoaded(true);
      // A new port has no browser preferences, not necessarily no history.
      // Never override an explicit collapse, or cover the screen on mobile.
      if (
        b.sessions.length && window.innerWidth > 650 &&
        localStorage.getItem("margin.sidebar") === null
      )
        setSidebar(true);
    } catch (error) {
      setLoadError(
        error instanceof Error && error.name === "TimeoutError"
          ? "Loading took too long. Check that Margin is running, then retry."
          : (error instanceof Error ? error.message : String(error)) || "Please retry.",
      );
    } finally {
      refreshing.current = false;
      setLoading(false);
    }
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
    } else if (loaded && homeOpen) localStorage.removeItem("margin.project");
  }, [projectId, loaded, homeOpen]);
  function activateSession(id: string | null) {
    if (selectedId.current === id) return;
    const previous = selectedId.current;
    if (previous && snapshotRef.current?.session.id === previous) {
      histories.put({ ...snapshotRef.current, composer: draftRef.current });
      if (scrollRef.current)
        positions.set(previous, {
          top: scrollRef.current.scrollTop,
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
      ? outbox.text(id, pendingDrafts.text(id, cached?.composer ?? "", cached?.composerRevision))
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
          const text = outbox.text(id, pendingDrafts.text(
            id,
            preview.composer,
            preview.composerRevision,
          ));
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
  useLayoutEffect(() => {
    if (
      !hubOpen &&
      sessionId &&
      pendingComposerFocus === sessionId &&
      snapshot?.session.id === sessionId &&
      composerEditor.current
    ) {
      setPendingComposerFocus(null);
      // Navigation focuses once, never on subsequent live snapshots or through a modal.
      if (!document.querySelector("dialog:modal"))
        composerEditor.current.focus({ preventScroll: true });
    }
  }, [pendingComposerFocus, sessionId, hubOpen, snapshot?.session.id]);
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
      if (routeRef.current.kind !== "home" && !hubOpen) localStorage.removeItem("margin.session");
      return;
    }
    localStorage.setItem("margin.session", sessionId);
    if (!histories.get(sessionId)) void prefetchSession(sessionId);
    return connectConversation({
      sessionId,
      onConnection: setConnected,
      onSnapshot: (s) => {
        if (deletedSessions.has(sessionId)) return;
        histories.put(s);
        if (selectedId.current !== s.session.id) return;
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
        const completed = outbox.observe(s);
        if (completed) {
          // Re-save any typing done during submission after the server's preflight
          // clear, or restore the original draft if preflight rejected the batch.
          pendingDrafts.set(s.session.id, completed.draft);
          void pendingDrafts.flush(s.session.id).catch(fail);
          if (completed.rejected) {
            lastAccepted.current = "";
            fail(
              new Error(
                "That message was not accepted. Your draft is restored; try again.",
              ),
            );
          }
        }
        const pending = pendingDrafts.get(s.session.id);
        const text = outbox.text(s.session.id, pendingDrafts.text(
          s.session.id,
          s.composer,
          s.composerRevision,
        ));
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
      },
    });
  }, [sessionId, loaded]);
  const navigationHandler = useRef<
    (next: AppRoute, index?: number) => Promise<void>
  >(async () => {});
  navigationHandler.current = async (next, index) => {
    if (index === undefined) {
      if (next.kind === "not-found")
        throw new Error("Unknown destination.");
      return go(next);
    }
    if (instructionsGuard.blocking && !sameInstructionsSurface(routeRef.current, next) && approvedHistory.current !== index) {
      const from = historyIndex.current;
      const targetUrl = location.pathname + location.search;
      // Popstate arrives after the URL moved. Restore the current entry before
      // asking in place, then replay the original traversal only on approval.
      if (from !== index) {
        await new Promise<void>((resolve) => {
          historyRestored.current = resolve;
          restoringHistory.current = true;
          history.go(from - index);
        });
      } else if (routeRef.current.kind !== "not-found") {
        history.replaceState({ marginIndex: from }, "", destinationUrl(routeRef.current));
      }
      if (!(await instructionsGuard.confirmLeave())) return;
      if (from !== index) {
        approvedHistory.current = index;
        history.go(index - from);
        return;
      }
      history.replaceState({ marginIndex: index }, "", targetUrl);
    }
    approvedHistory.current = null;
    try {
      if (editing || sending || managing)
        throw new Error(
          "Finish or cancel your draft comment, and wait for sending to finish before navigating.",
        );
      void flushDraft().catch(fail);
      historyIndex.current = index;
      setError("");
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
        historyRestored.current?.();
        historyRestored.current = null;
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
          projects?: Project[];
          workspaceErrors?: string[];
        }>("/sessions");
        if (!cancelled) {
          setBoot((b) => ({
            ...b,
            sessions: result.sessions.filter((s) => !deletedSessions.has(s.id)),
            projects: result.projects ?? b.projects,
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
  useLayoutEffect(() => {
    if (stickyBottom.current && scrollRef.current)
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    snapshot?.messages.length,
    snapshot?.messages.at(-1)?.text,
    snapshot?.dialogs.length,
    outbox.get(sessionId)?.id,
  ]);
  function updateDraft(text: string) {
    updateChatDraft(sessionId, text);
  }
  function updateChatDraft(id: string | null, text: string) {
    if (id && deletedSessions.has(id)) return;
    if (id) {
      outbox.edit(id, text);
      pendingDrafts.set(id, text);
    }
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
      if (window.innerWidth <= 650) setSidebar(false);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }
  async function createSession() {
    if (!(await instructionsGuard.confirmLeave())) return;
    if (editing) {
      setError(
        "Finish or cancel your draft comment before starting a conversation.",
      );
      return;
    }
    setSending(true);
    try {
      if (unavailableNewModel)
        throw new Error(
          "The selected model is unavailable. Choose another model or configure its provider in Settings.",
        );
      await flushDraft();
      const s = await api<Snapshot>("/sessions", {
        projectId,
        model: boot.models.find((m) => modelKey(m) === newModel),
      });
      setNewModel("");
      histories.put(s);
      const data = { ...boot, sessions: [s.session, ...boot.sessions] };
      setBoot(data);
      writeRoute({
        kind: "chat",
        sessionId: s.session.id,
        panel: workspacePanel(),
      });
      applyRoute(routeRef.current, data);
      if (window.innerWidth <= 650) setSidebar(false);
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
  async function openHelp() {
    if (helpOpening.current) return;
    setHelpError("");
    if (!boot.models.length) {
      window.open(marginIssuesUrl, "_blank", "noopener,noreferrer");
      return;
    }
    helpOpening.current = true;
    setOpeningHelp(true);
    try {
      const project = boot.projects.find((p) => p.id === boot.marginProjectId) ??
        (await api<{ project: Project }>("/customize")).project;
      await customizationPrompt(project, marginHelpPrompt);
      if (window.innerWidth <= 650) setSidebar(false);
    } catch (e) {
      setHelpError(e instanceof Error ? e.message : String(e));
    } finally {
      helpOpening.current = false;
      setOpeningHelp(false);
    }
  }
  async function customizationPrompt(project: Project, prompt: string) {
    if (editing) {
      throw new Error("Finish or cancel your draft comment before starting a conversation.");
    }
    if (!(await instructionsGuard.confirmLeave())) return;
    await flushDraft();
    const s = await api<Snapshot>("/sessions", {
      projectId: project.id,
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
    if (!(await instructionsGuard.confirmLeave())) return;
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
    if (!editing || !snapshot || !editing.text.trim() || savingComment.current) return;
    savingComment.current = true;
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
    } finally {
      savingComment.current = false;
    }
  }
  function sendDisabledReason(): string | undefined {
    if (!snapshot || snapshot.session.id !== selectedId.current || !connected)
      return "Wait for the conversation to connect.";
    if (sending || outbox.get(sessionId))
      return "A reply is already being sent.";
    if (sourceSend.disabled)
      return sourceSend.reason || "Sending is unavailable.";
    if (editing) return "Finish or cancel your draft comment before sending.";
    if (snapshot.busy) return "Wait for the assistant to finish.";
    if (snapshot.dialogs.length)
      return "Answer or cancel the pending dialog first.";
    if (attachments.hasPending(snapshot.session.id))
      return "Finish uploading or remove failed attachments before sending.";
  }
  async function send(reply?: {
    sessionId: string;
    messageId: string;
    text: string;
  }) {
    if (!snapshot || sendDisabledReason()) return;
    if (reply) {
      if (
        reply.sessionId !== snapshot.session.id ||
        reply.messageId !== replyActionMessageId(snapshot.messages)
      ) return;
      // Save the combined draft before submission, so failures/reloads recover
      // the choice as well as the user's original text. Do not replace feedback.
      updateChatDraft(
        snapshot.session.id,
        appendReplyAction(draftRef.current, reply.text),
      );
    }
    setSending(true);
    setError("");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const note = draftRef.current,
      sendingSession = snapshot.session.id,
      ids = snapshot.comments
        .filter((c) => c.status === "draft")
        .map((c) => c.id);
    const attachmentIds = attachments.ids(snapshot.session.id);
    const fingerprint = JSON.stringify({ note, ids, skill, attachmentIds });
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
      const batch = {
        id, note, commentIds: ids,
        ...(attachmentIds.length ? { attachmentIds } : {}),
        ...(skill ? { skill } : {}),
      };
      outbox.begin(snapshot, batch, attachments.files);
      // One React update moves the composer, empties it, and paints the bubble.
      // Do not persist this visual clear: keep the original draft recoverable.
      setDraft("");
      draftRef.current = "";
      stickyBottom.current = true;
      await flushDraft();
      const result = await api<{ status: string }>(
        `/sessions/${sendingSession}/send`, batch,
      );
      if (result.status === "rejected") {
        lastAccepted.current = "";
        throw new Error(
          "That message was not accepted. Your draft is saved; try again.",
        );
      }
      if (result.status === "accepted") outbox.accept(sendingSession, id);
      if (selectedId.current === sendingSession) {
        setSkill("");
        if (sendingSession) skillChoices.set(sendingSession, "");
        skillChosen.current = true;
        stickyBottom.current = true;
      }
    } catch (e) {
      // A lost HTTP response must not restore a duplicate if the stream already
      // confirmed acceptance. Otherwise restore both the note and newer typing.
      if (outbox.get(sendingSession)?.status !== "accepted") {
        const restored = outbox.reject(sendingSession, id);
        if (restored !== undefined) updateChatDraft(sendingSession, restored);
      }
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
    setCommentReveal(null);
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
    if (open && sessionId) {
      // Cards are laid out by passage, which is not necessarily creation order.
      const latest = allComments.reduce<Comment | undefined>(
        (last, comment) =>
          !last || comment.createdAt >= last.createdAt ? comment : last,
        undefined,
      );
      const commentId = editing
        ? (editing.id ?? "editing")
        : (latest?.id ?? null);
      stickyBottom.current = false;
      setActive(commentId);
      setCommentReveal({ sessionId, commentId });
    } else setCommentReveal(null);
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
  useLayoutEffect(() => {
    if (!commentReveal || commentReveal.sessionId !== sessionId || !rail) return;
    // Opening the rail reflows the thread; card gaps settle in a second render.
    const frame = requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const target = commentReveal.commentId
        ? railList.current?.querySelector<HTMLElement>(
            `[data-comment-id="${CSS.escape(commentReveal.commentId)}"]`,
          )
        : railList.current?.closest<HTMLElement>(".comment-rail");
      if (scroller && target)
        scroller.scrollBy({
          top:
            target.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            16,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      setCommentReveal(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [commentReveal, commentGaps, sessionId, rail, panel]);
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
  const outgoing = outbox.get(sessionId);
  const sendReason = sendDisabledReason();
  const activeReplyMessageId = snapshot && replyActionMessageId(snapshot.messages);
  const messages = snapshot
    ? [...snapshot.messages, ...(outgoing ? [outgoing.message] : [])]
    : [];
  const currentActivity =
    boot.sessions.find((s) => s.id === sessionId)?.activity ??
    snapshot?.session.activity;
  const isUnread = useUnread(
    sessionId,
    currentActivity,
    !homeOpen && !hubOpen &&
      !routeMissing &&
      !!snapshot &&
      !allWorkspaces &&
      !settingsOpen &&
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
  const agentName =
    (snapshot?.session.backend ?? "pi") === "pi"
      ? "Assistant"
      : (snapshot?.session.backendLabel ?? "Assistant");
  const conversationTitle =
    (snapshot?.session.id === sessionId ? snapshot.session.title : undefined) ??
    boot.sessions.find((s) => s.id === sessionId)?.title ??
    "New conversation";
  const connectionLabel = !loaded
    ? loadError ? "Loading failed" : "Loading Margin…"
    : sessionId ? connected ? "Connected" : "Reconnecting…" : "Ready";
  const pageTitle = hubOpen
    ? "Margin · Customize Margin"
    : workspaceHomeOpen && currentProject && !routeMissing
      ? `Margin · ${currentProject.name}`
    : sessionId && !routeMissing
      ? `Margin · ${conversationTitle}`
      : "Margin";
  useEffect(() => {
    document.title = pageTitle;
  }, [pageTitle]);
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
                    attachments.forgetSession(target.id);
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
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onModelsChanged={(models) => setBoot((current) => ({ ...current, models }))}
        />
      )}
      <header className="app-header">
        <div className="header-left">
          <button
            className="sidebar-toggle"
            type="button"
            aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
            title={sidebar ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={sidebar}
            aria-controls="workspace-sidebar"
            onClick={toggleSidebar}
          >
            {sidebar ? <PanelLeftClose size={21} /> : <PanelLeftOpen size={21} />}
          </button>
          <button
            className="brand"
            type="button"
            aria-label="Margin home"
            title="Go to homepage"
            disabled={!loaded || choosingWorkspace}
            onClick={() => void go({ kind: "home" }).catch(fail)}
          >
            <span>margin <small>by Steerbits</small></span>
          </button>
        </div>
        <div className="header-right">
          <span
            className={`connection ${connected ? "connected" : ""}`}
            role={!loaded ? "status" : undefined}
            title={connectionLabel}
          >
            {!loaded && !loadError
              ? <LoaderCircle size={14} className="spin" aria-hidden="true" />
              : <Circle size={7} fill="currentColor" aria-hidden="true" />}
            <span className="connection-label">
              {connectionLabel}
            </span>
          </span>
          <button
            aria-label="Help"
            title={boot.models.length ? "Help with Margin" : "Help — GitHub issues (new tab)"}
            disabled={loading || openingHelp}
            onClick={() => void openHelp()}
          >
            {openingHelp ? <LoaderCircle size={18} className="spin" /> : <CircleHelp size={18} />}
          </button>
          <button
            aria-label="Settings"
            title="Settings"
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings size={18} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside
          className="sidebar"
          id="workspace-sidebar"
          aria-label="Workspace navigation"
        >
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
              disabled={!loaded || choosingWorkspace}
              aria-busy={(!loaded && !loadError) || choosingWorkspace}
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
            {!projectId && <option value="" disabled>
              {!loaded ? (loadError ? "Workspaces unavailable" : "Loading workspaces…") : "Choose a workspace"}
            </option>}
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
            onClick={() => workspaceHomeOpen
              ? void go({ kind: "workspace", projectId, view: "new", panel: workspacePanel() }).catch(fail)
              : void createSession()}
            disabled={sending || !projectId}
          >
            <Plus size={16} />
            New conversation<span>⌘</span>
          </button>
          {!loaded ? (
            <div className="sidebar-conversations" role="status" aria-busy={!loadError}>
              <p className="sidebar-empty startup-status">
                {!loadError && <LoaderCircle size={16} className="spin" aria-hidden="true" />}
                {loadError ? "Conversations could not be loaded. Retry loading to see your chats." : "Loading conversations…"}
              </p>
            </div>
          ) : (
            <SidebarConversations
              sessions={boot.sessions}
              projects={boot.projects}
              projectId={projectId}
              sessionId={sessionId}
              isUnread={isUnread}
              onSelect={switchSession}
              onPrefetch={(id) => {
                if (!histories.get(id)) void prefetchSession(id);
              }}
              onContextMenu={(session, x, y) => setContextMenu({ session, x, y })}
            />
          )}
        </aside>
        <main className="main" {...attachments.dropProps}>
          {attachments.overlay}
          {loadError && (
            <div className="notice error startup-error" role="alert">
              <span>{loaded ? "Could not refresh Margin." : "Could not load Margin."} {loadError}</span>
              <button onClick={() => void refresh()} disabled={loading}>
                Retry loading
              </button>
            </div>
          )}
          {helpError && (
            <div className="notice error" role="alert">
              <span>Could not open Help. {helpError} <a href={marginIssuesUrl} target="_blank" rel="noopener noreferrer">Get help on GitHub</a></span>
              <button aria-label="Dismiss help error" onClick={() => setHelpError("")}>
                <X size={15} />
              </button>
            </div>
          )}
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
          {homeOpen ? (
            <Home
              loaded={loaded}
              loadError={loadError}
              models={boot.models}
              modelError={boot.modelError}
              projects={orderedProjects.filter((project) => project.id !== boot.marginProjectId && project.kind !== "margin")}
              choosingWorkspace={choosingWorkspace}
              onSettings={() => setSettingsOpen(true)}
              onOpenWorkspace={() => void chooseWorkspace()}
              onSelectWorkspace={(project) => void openProject(project).catch(fail)}
              onCustomize={() => void openCustomization().catch(fail)}
            />
          ) : routeMissing ? (
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
              instructionsGuard={instructionsGuard}
              tab={hubTab}
              onTabChange={(tab) =>
                void go({ kind: "customize", tab }).catch(fail)
              }
              onClose={() =>
                void go(
                  returnRoute.current ?? { kind: "home" },
                ).catch(fail)
              }
              onPrompt={customizationPrompt}
            />
          ) : (
            <>
              <div className="toolbar">
                <div className="toolbar-left">
                  <Folder size={15} />
                  <a
                    className="project-breadcrumb"
                    href={destinationUrl({ kind: "workspace", projectId, panel: workspacePanel() })}
                    title={`Workspace home${currentProject?.path ? ` · ${currentProject.path}` : ""}`}
                    aria-label={`Workspace home: ${currentProject?.name ?? "Margin"}`}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      if (loaded) void go({ kind: "workspace", projectId, panel: workspacePanel() }).catch(fail);
                    }}
                  >
                    <span>{currentProject?.name ?? "Workspace"}</span>
                  </a>
                  {!workspaceHomeOpen && <>
                    <span className="crumb-separator">/</span>
                    <span className="conversation-title">{conversationTitle}</span>
                  </>}
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
                    aria-expanded={rail}
                    onClick={() => showComments(true)}
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
                inlineComposer={
                  !!snapshot &&
                  !messages.length &&
                  !sending
                }
                composer={snapshot && (
                  <div className={`review ${rail ? "with-rail" : ""}`}>
                    <div className="composer-dock-content">
                      <form
                        className="composer"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void send();
                        }}
                      >
                        {draftCount > 0 && !outgoing && (
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
                        {!outgoing && attachments.chips}
                        <textarea
                          ref={composerEditor}
                          onPaste={attachments.paste}
                          aria-label="Message"
                          placeholder={
                            attachments.files.length
                              ? "Add a message about these files (optional)…"
                              : draftCount
                                ? "Add an overall reply (optional)…"
                                : "Message… or select a passage above to comment"
                          }
                          value={draft}
                          onChange={(e) => updateDraft(e.target.value)}
                          rows={3}
                          onKeyDown={(e) => submitOnEnter(e, () => {
                            if (draft.trim() || draftCount || attachments.files.length)
                              void send();
                          })}
                        />
                        <div className="composer-footer">
                          <div className="composer-options">
                            {snapshot.attachmentSupport && attachments.button}
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
                            {model && (
                              <>
                                <select
                                  className="model-choice"
                                  aria-label="Model"
                                  disabled={
                                    busy || !connected || !boot.models.length
                                  }
                                  title={modelLabel(model)}
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
                                  {!boot.models.length ? (
                                    <option value={modelKey(model)}>
                                      {configureModelLabel}
                                    </option>
                                  ) : (
                                    !boot.models.some(
                                      (m) => modelKey(m) === modelKey(model),
                                    ) && (
                                      <option value={modelKey(model)} disabled>
                                        {modelLabel(model)} (unavailable)
                                      </option>
                                    )
                                  )}
                                  <ModelOptions
                                    models={boot.models}
                                    keyFor={modelKey}
                                  />
                                </select>
                                {!boot.models.length && (
                                  <button
                                    type="button"
                                    className="text-link"
                                    onClick={() => setSettingsOpen(true)}
                                  >
                                    Open Settings
                                  </button>
                                )}
                                {snapshot.thinking && (
                                  <label className="thinking-choice">
                                    <span>Thinking</span>
                                    <select
                                      aria-label="Thinking effort"
                                      disabled={
                                        busy ||
                                        !connected ||
                                        snapshot.thinking.available.length < 2
                                      }
                                      value={snapshot.thinking.level}
                                      onChange={(event) =>
                                        void api(
                                          `/sessions/${sessionId}/thinking`,
                                          { level: event.target.value },
                                        ).catch(fail)
                                      }
                                    >
                                      {snapshot.thinking.available.map((level) => (
                                        <option key={level} value={level}>
                                          {level === "server" ? thinkingDefaultLabel(model.thinkingControl) : thinkingChoiceLabel(level, model.thinkingControl)}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                              </>
                            )}
                          </div>
                          {busy ? (
                            <button
                              type="button"
                              className="stop-button"
                              key="stop"
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
                              key="send"
                              aria-describedby={
                                sourceSend.reason ? "source-send-reason" : undefined
                              }
                              aria-label={
                                draftCount
                                  ? `Send ${draftCount} comment${draftCount === 1 ? "" : "s"}`
                                  : "Send message"
                              }
                              type="submit"
                              title="Send (Enter); Shift+Enter for a new line"
                              aria-keyshortcuts="Enter Meta+Enter Control+Enter"
                              disabled={
                                !!sendReason ||
                                (!draft.trim() && !draftCount &&
                                  !attachments.files.length)
                              }
                            >
                              <ArrowUp size={19} />
                            </button>
                          )}
                        </div>
                      </form>
                      {!busy && sourceSend.reason && (
                        <div
                          className="source-send-notice"
                          id="source-send-reason"
                          role="status"
                        >
                          <span>{sourceSend.reason}</span>
                          {sourceSend.blockingSessionId &&
                            sourceSend.blockingSessionId !== sessionId && (
                              <a
                                href={destinationUrl({
                                  kind: "chat",
                                  sessionId: sourceSend.blockingSessionId,
                                })}
                                onClick={(event) => {
                                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                                    return;
                                  event.preventDefault();
                                  void switchSession(sourceSend.blockingSessionId!);
                                }}
                              >
                                View running conversation
                              </a>
                            )}
                          {sourceSend.failed && (
                            <button type="button" onClick={sourceSend.retry}>
                              Retry
                            </button>
                          )}
                        </div>
                      )}
                      {editing && (
                        <div className="composer-hint" role="status">
                          Finish or cancel your draft comment before sending.
                        </div>
                      )}
                    </div>
                  </div>
                )}
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
                {workspaceHomeOpen && currentProject ? (
                  <WorkspaceHome project={currentProject} guard={instructionsGuard}
                    onNewConversation={() => void go({ kind: "workspace", projectId, view: "new", panel: workspacePanel() }).catch(fail)}
                    onGlobal={() => void go({ kind: "customize", tab: "instructions" }).catch(fail)} />
                ) : !snapshot && sessionId ? (
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
                      Work with your assistant. Read closely, leave comments in
                      the margin,
                      <br className="desktop-break" /> and shape the next step
                      together.
                    </p>
                    {!boot.models.length ? (
                      <div className="start-card first-connection-card">
                        <div className="first-connection-heading">
                          <Plug size={20} />
                          <strong>Bring your AI to Margin</strong>
                        </div>
                        <p>
                          Use your ChatGPT subscription, connect an API key,
                          <br className="desktop-break" /> or work with a local
                          model.
                        </p>
                        <button
                          className="primary"
                          onClick={() => setSettingsOpen(true)}
                        >
                          Connect an AI provider{" "}
                          <ArrowUp size={16} className="connection-arrow" />
                        </button>
                        <span>
                          Your connections stay private to this installation.
                        </span>
                      </div>
                    ) : (
                      <div className="start-card">
                        <label htmlFor="start-model">Start with a model</label>
                        <select
                          id="start-model"
                          value={boot.models.length ? newModel : ""}
                          disabled={!boot.models.length}
                          onChange={(e) => setNewModel(e.target.value)}
                        >
                          <option value="">
                            {boot.models.length
                              ? "Default from Settings"
                              : configureModelLabel}
                          </option>
                          {unavailableNewModel && boot.models.length > 0 && (
                            <option value={newModel} disabled>
                              Selected model unavailable — choose another
                            </option>
                          )}
                          <ModelOptions
                            models={boot.models}
                            keyFor={modelKey}
                          />
                        </select>
                        <button
                          className="primary"
                          onClick={() => void createSession()}
                          disabled={
                            sending ||
                            !boot.models.length ||
                            !projectId ||
                            unavailableNewModel
                          }
                        >
                          <Plus size={16} />
                          Start a conversation
                        </button>
                      </div>
                    )}
                    {!boot.models.length && (
                      <p className="setup-hint">
                        <button
                          className="text-link"
                          onClick={() =>
                            void api("/models/refresh", {})
                              .then(refresh)
                              .catch(fail)
                          }
                        >
                          Refresh models
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
                      {!messages.length && (
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
                      {messages.map((m) =>
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
                                    replyActions={{
                                      onSend: (text) =>
                                        void send({
                                          sessionId: snapshot.session.id,
                                          messageId: m.id,
                                          text,
                                        }),
                                      disabledReason:
                                        m.id !== activeReplyMessageId
                                          ? "Only the latest completed reply can be sent."
                                          : sendReason,
                                    }}
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
                                {m.text && <UserMessage text={m.text} />}
                                <SentAttachments
                                  sessionId={snapshot.session.id}
                                  files={m.attachments}
                                />
                                {m.id === outgoing?.message.id && (
                                  <span className="send-status" role="status">
                                    {outgoing.status === "accepted" ? "Sent" : "Sending…"}
                                  </span>
                                )}
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
                                        submitOnEnter(e, () => void saveComment());
                                        if (e.key === "Escape" && !e.nativeEvent.isComposing)
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
                                        title="Save comment (Enter); Shift+Enter for a new line"
                                        aria-keyshortcuts="Enter Meta+Enter Control+Enter"
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
