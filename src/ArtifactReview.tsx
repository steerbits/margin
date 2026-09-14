import { useEffect, useRef, useState } from "react";
import {
  ExternalLink,
  FileText,
  Globe,
  MessageSquarePlus,
  MousePointer2,
  RotateCw,
  X,
} from "lucide-react";
import type {
  Artifact,
  ArtifactAnchor,
  ArtifactComment,
  ArtifactReview,
  PreviewConnection,
} from "../shared/artifacts.ts";
import { artifactReviewUrl } from "../shared/artifacts.ts";
import { api } from "./api.ts";
import { ArtifactDrafts, saveArtifactComment } from "./artifact-drafts.ts";
import {
  artifactInitialRoute,
  previousPageComments,
} from "./artifact-history.ts";
import {
  OverallFeedbackDraft,
  saveOverallFeedback,
} from "./artifact-overall.ts";
import "./ArtifactReview.css";

export function requestArtifactReview(href: string) {
  const url = new URL(href, location.origin);
  const match =
    url.origin === location.origin &&
    url.pathname.match(/^\/review\/([a-f0-9-]{36})$/);
  if (!match) return false;
  return !window.dispatchEvent(
    new CustomEvent("margin:artifact-review", {
      cancelable: true,
      detail: {
        sessionId: match[1],
        artifactId: url.searchParams.get("artifact") ?? undefined,
        location: url.searchParams.get("location") ?? undefined,
      },
    }),
  );
}
function isReviewBackdrop(event: {
  target: EventTarget;
  currentTarget: HTMLDialogElement;
  clientX: number;
  clientY: number;
}) {
  if (event.target !== event.currentTarget) return false;
  const bounds = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom
  );
}

export function ArtifactLauncher({
  sessionId,
  onSent,
}: {
  sessionId: string;
  onSent?: () => void;
}) {
  const [open, setOpen] = useState(false),
    [artifactId, setArtifactId] = useState<string>();
  const [sourceLocation, setSourceLocation] = useState<string>();
  const [hasArtifacts, setHasArtifacts] = useState(
    () => !!localStorage.getItem(`margin-artifact-selected:${sessionId}`),
  );
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const review = await api<ArtifactReview>(
          `/sessions/${sessionId}/artifacts`,
        );
        if (disposed) return;
        setHasArtifacts(review.artifacts.length > 0);
        // Registration is durable and artifacts aren't removed individually.
        if (review.artifacts.length) return;
      } catch {
        /* Keep known reviews accessible through temporary outages. */
      }
      if (!disposed) timer = setTimeout(() => void check(), 2000);
    }
    void check();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [sessionId]);
  useEffect(() => {
    const listener = (event: Event) => {
      const e = event as CustomEvent<{
        sessionId: string;
        artifactId?: string;
        location?: string;
      }>;
      if (e.detail.sessionId !== sessionId) return;
      e.preventDefault();
      setArtifactId(e.detail.artifactId);
      setSourceLocation(e.detail.location);
      setOpen(true);
    };
    window.addEventListener("margin:artifact-review", listener);
    return () => window.removeEventListener("margin:artifact-review", listener);
  }, [sessionId]);
  return (
    <>
      {hasArtifacts && (
        <button
          onClick={() => {
            setArtifactId(undefined);
            setSourceLocation(undefined);
            setOpen(true);
          }}
        >
          <FileText size={16} />
          Artifacts
        </button>
      )}
      {open && (
        <ArtifactReviewWindow
          sessionId={sessionId}
          initialArtifactId={artifactId}
          initialLocation={sourceLocation}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            onSent?.();
          }}
        />
      )}
    </>
  );
}

export function ArtifactReviewWindow({
  sessionId,
  initialArtifactId,
  initialLocation,
  onClose,
  onSent,
  standalone = false,
}: {
  sessionId: string;
  initialArtifactId?: string;
  initialLocation?: string;
  onClose?: () => void;
  onSent?: () => void;
  standalone?: boolean;
}) {
  const [state, setState] = useState<
    ArtifactReview & { busy: boolean; sendBlockReason?: string | null }
  >({
    artifacts: [],
    comments: [],
    busy: true,
  });
  const [artifactId, setArtifactId] = useState(
    () =>
      initialArtifactId ??
      localStorage.getItem(`margin-artifact-selected:${sessionId}`) ??
      "",
  );
  const [connection, setConnection] = useState<
    PreviewConnection & { artifactId: string }
  >();
  const [error, setError] = useState(""),
    [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pointing, setPointing] = useState(false),
    [ready, setReady] = useState(false);
  const [currentRoute, setCurrentRoute] = useState(""),
    [revision, setRevision] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState("");
  const [deleteId, setDeleteId] = useState(""),
    [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const mounted = useRef(true);
  const pendingBatch = useRef<string | undefined>(undefined);
  const posting = useRef(false);
  const drafts = useRef<ArtifactDrafts | null>(null);
  if (!drafts.current)
    drafts.current = new ArtifactDrafts(
      sessionId,
      localStorage,
      (c) => saveArtifactComment(sessionId, c),
      () => setTick((n) => n + 1),
    );
  const queue = drafts.current;
  const overallRef = useRef<OverallFeedbackDraft | null>(null);
  if (!overallRef.current)
    overallRef.current = new OverallFeedbackDraft(
      sessionId,
      localStorage,
      (value) => saveOverallFeedback(sessionId, value),
      () => setTick((n) => n + 1),
    );
  const overall = overallRef.current;
  overall.observe(state.overall);
  const dialog = useRef<HTMLDialogElement>(null),
    frame = useRef<HTMLIFrameElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pressedBackdrop = useRef(false);
  const artifact = state.artifacts.find((a) => a.id === artifactId);
  const comments = queue.merge(state.comments).filter((c) => !c.deleted);
  const currentComments = comments.filter((c) => c.delivery !== "sent");
  const pageRoute =
    connection?.artifactId === artifactId && currentRoute
      ? currentRoute
      : artifact
        ? artifactInitialRoute(artifact)
        : "";
  const previousComments = previousPageComments(
    comments,
    artifactId,
    pageRoute,
  );
  const visibleComments = [
    ...currentComments,
    ...(historyOpen ? previousComments : []),
  ];
  const draftComments = comments.filter(
    (c) => c.delivery === "draft" && c.saved !== false && c.text.trim(),
  );
  const unfinished = comments.filter(
    (c) => c.delivery === "draft" && c.saved === false && c.text.trim(),
  );
  const latest = useRef({
    artifact,
    comments: visibleComments,
    pointing,
    sending,
  });
  latest.current = { artifact, comments: visibleComments, pointing, sending };
  function confirmSubmission(id: string, status: string) {
    if (!mounted.current || pendingBatch.current !== id) return;
    if (status === "accepted") {
      pendingBatch.current = undefined;
      setSending(false);
      if (standalone) location.assign(`/chats/${sessionId}`);
      else (onSent ?? onClose)?.();
    } else if (status === "rejected") {
      pendingBatch.current = undefined;
      setSending(false);
      setError(
        "Feedback was not accepted. Your comments and overall feedback are still here; review and try again.",
      );
    }
  }
  async function refresh() {
    const batch = pendingBatch.current;
    const next = await api<
      ArtifactReview & { busy: boolean; sendBlockReason?: string | null }
    >(
      `/sessions/${sessionId}/artifacts${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`,
    );
    if (!mounted.current) return;
    setState(next);
    setLoaded(true);
    setConnected(true);
    setArtifactId((id) => id || next.artifacts.at(-1)?.id || "");
    if (next.submission)
      confirmSubmission(next.submission.id, next.submission.status);
    else if (batch && pendingBatch.current === batch) {
      pendingBatch.current = undefined;
      setSending(false);
      setError(
        "This server cannot confirm artifact submissions yet. Check the chat before retrying, then restart Margin to load the update.",
      );
    }
  }
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const failed = (e: Error) => {
      if (!disposed) {
        setError(e.message);
        setConnected(false);
      }
    };
    const update = () => {
      if (!disposed) void refresh().catch(failed);
    };
    void (async () => {
      if (initialLocation) {
        const added = await api<Artifact>(`/sessions/${sessionId}/artifacts`, {
          location: initialLocation,
        });
        if (disposed) return;
        setArtifactId(added.id);
      }
      await refresh();
    })().catch(failed);
    const timer = setInterval(update, 1500);
    void queue.flush().catch(() => {});
    void overall.flush().catch(() => {});
    const leaving = (e: BeforeUnloadEvent) => {
      if (queue.dirty || overall.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leaving);
    return () => {
      disposed = true;
      mounted.current = false;
      clearInterval(timer);
      clearTimeout(saveTimer.current);
      window.removeEventListener("beforeunload", leaving);
      void queue.flush().catch(() => {});
      void overall.flush().catch(() => {});
    };
  }, []);
  useEffect(() => {
    if (standalone) return;
    dialog.current?.showModal();
    return () => dialog.current?.close();
  }, [standalone]);
  const post = (type: string, data: object = {}) => {
    if (connection && latest.current.artifact?.id === connection.artifactId)
      frame.current?.contentWindow?.postMessage(
        { type, channel: connection.channel, ...data },
        connection.origin,
      );
  };
  function edit(comment: ArtifactComment) {
    queue.edit(comment);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void Promise.all([queue.flush(), overall.flush()]).catch(() => {});
    }, 300);
  }
  function editOverall(text: string) {
    overall.edit(text);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void Promise.all([queue.flush(), overall.flush()]).catch(() => {});
    }, 300);
  }
  async function saveComment(comment: ArtifactComment) {
    if (!comment.text.trim()) return;
    edit({ ...comment, saved: true });
    try {
      await queue.flush();
    } catch {
      /* Recovery journal remains available. */
    }
  }
  function select(anchor: ArtifactAnchor) {
    const current = latest.current;
    if (!current.artifact || current.sending) return;
    const existing = current.comments.find(
      (c) =>
        c.artifactId === current.artifact!.id &&
        c.delivery === "draft" &&
        c.saved === false &&
        !c.text,
    );
    const comment: ArtifactComment = existing
      ? { ...existing, anchor }
      : {
          id: crypto.randomUUID(),
          artifactId: current.artifact.id,
          anchor,
          text: "",
          revision: 0,
          mutationId: crypto.randomUUID(),
          delivery: "draft",
          saved: false,
          createdAt: Date.now(),
        };
    edit(comment);
    setActiveId(comment.id);
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLTextAreaElement>(
          `[data-artifact-comment="${comment.id}"] textarea`,
        )
        ?.focus(),
    );
  }
  useEffect(() => {
    if (!artifact) return;
    localStorage.setItem(`margin-artifact-selected:${sessionId}`, artifact.id);
    let cancelled = false;
    setConnection(undefined);
    setReady(false);
    setStatus({});
    setPointing(false);
    setCurrentRoute("");
    setError("");
    void api<PreviewConnection>(
      `/sessions/${sessionId}/artifacts/${artifact.id}/preview`,
      { parentOrigin: location.origin },
    )
      .then((c) => {
        if (!cancelled) setConnection({ ...c, artifactId: artifact.id });
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [artifactId, artifact?.id]);
  useEffect(() => {
    if (!connection) return;
    const listener = (event: MessageEvent) => {
      if (
        latest.current.artifact?.id !== connection.artifactId ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== connection.origin ||
        event.data?.source !== "margin-artifact" ||
        event.data.channel !== connection.channel
      )
        return;
      const data = event.data;
      if (data.type === "ready") {
        setReady(true);
        if (
          typeof data.route === "string" &&
          data.route.startsWith("/") &&
          !data.route.startsWith("//")
        )
          setCurrentRoute(data.route.slice(0, 4096));
        if (typeof data.revision === "string")
          setRevision(data.revision.slice(0, 100));
        post("mode", { pointing: latest.current.pointing });
        post("inspect", {
          comments: latest.current.comments
            .filter((c) => c.artifactId === connection.artifactId)
            .map((c) => ({
              id: c.id,
              anchor: c.anchor,
            })),
        });
      } else if (
        data.type === "selected" &&
        data.anchor &&
        typeof data.anchor.quote === "string" &&
        data.anchor.quote.length <= 10000 &&
        ["element", "text", "page"].includes(data.anchor.kind)
      )
        select(data.anchor);
      else if (
        data.type === "anchors" &&
        data.status &&
        typeof data.status === "object"
      )
        setStatus(data.status);
      else if (data.type === "mode") setPointing(!!data.pointing);
      else if (data.type === "located" && !data.found)
        setError(
          "The original target is not on this screen. Its saved context and comment are preserved.",
        );
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [connection]);
  useEffect(() => {
    post("inspect", {
      comments: visibleComments
        .filter((c) => c.artifactId === artifactId)
        .map((c) => ({ id: c.id, anchor: c.anchor })),
    });
  }, [connection, state.comments, tick, historyOpen, pageRoute]);
  useEffect(() => {
    if (!connection || ready) return;
    const timeout = setTimeout(
      () =>
        setError(
          "Inline selection has not connected. The app may be offline, block embedding/scripts, or use unsupported routing. Your comments are safe; retry or open the original.",
        ),
      10000,
    );
    return () => clearTimeout(timeout);
  }, [connection, ready]);
  async function send() {
    if (posting.current || pendingBatch.current) return;
    posting.current = true;
    setSending(true);
    setError("");
    try {
      await Promise.all([queue.flush(), overall.flush()]);
      const ids = queue
        .merge(state.comments)
        .filter(
          (c) =>
            !c.deleted &&
            c.saved !== false &&
            c.delivery === "draft" &&
            c.text.trim(),
        )
        .map((c) => c.id);
      const id = crypto.randomUUID();
      const result = await api<{ status: string }>(
        `/sessions/${sessionId}/artifacts/send`,
        {
          id,
          commentIds: ids,
          overallRevision: overall.revision,
        },
      );
      if (!mounted.current) return;
      pendingBatch.current = id;
      confirmSubmission(id, result.status);
      if (pendingBatch.current) await refresh();
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      posting.current = false;
      if (mounted.current && !pendingBatch.current) setSending(false);
    }
  }
  async function remove(comment: ArtifactComment) {
    try {
      await queue.flush();
      const latest =
        queue.merge([]).find((c) => c.id === comment.id) ?? comment;
      const saved = await saveArtifactComment(sessionId, {
        ...latest,
        deleted: true,
        mutationId: crypto.randomUUID(),
      });
      queue.merge([saved]);
      setDeleteId("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function original() {
    if (!artifact) return;
    if (artifact.kind === "app") {
      window.open(artifact.location, "_blank", "noopener,noreferrer");
      return;
    }
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const c = await api<PreviewConnection>(
        `/sessions/${sessionId}/artifacts/${artifact.id}/preview`,
        { parentOrigin: location.origin, original: true },
      );
      if (tab) tab.location.href = c.url;
      else setError("Allow popups to open the original file.");
    } catch (e) {
      tab?.close();
      setError((e as Error).message);
    }
  }
  const address = artifact
    ? artifact.kind === "app"
      ? currentRoute
        ? new URL(artifact.location).origin + currentRoute
        : artifact.location
      : currentRoute
        ? decodeURI(currentRoute.replace(/^\//, ""))
        : artifact.location
    : "No artifact selected";
  const sendBlockReason =
    !loaded || !connected
      ? "Connecting to the conversation. Your feedback is kept."
      : state.busy
        ? (state.sendBlockReason ??
          "The agent is working. Your feedback is saved; send when ready.")
        : overall.conflict
          ? "Choose which overall feedback to keep before sending."
          : unfinished.length
            ? `Save ${unfinished.length === 1 ? "your unfinished comment" : `your ${unfinished.length} unfinished comments`} to attach ${unfinished.length === 1 ? "it" : "them"} before sending.`
            : !draftComments.length && !overall.text.trim()
              ? "Save a comment or write overall feedback to send."
              : "Sends to this conversation";
  const canSend =
    loaded &&
    connected &&
    !state.busy &&
    !sending &&
    !unfinished.length &&
    !overall.conflict &&
    (!!draftComments.length || !!overall.text.trim());
  const content = (
    <>
      <header className="artifact-chrome">
        <div className="artifact-title">
          <span className="artifact-brand">Margin</span>
          <span>Artifact review</span>
          <span className="artifact-private">Saved with this conversation</span>
        </div>
        <div className="artifact-window-actions">
          {!standalone && (
            <button
              title="Open review in a separate browser window"
              onClick={() =>
                window.open(
                  artifactReviewUrl(sessionId, artifactId),
                  "_blank",
                  "popup,width=1400,height=950,noopener",
                )
              }
            >
              <ExternalLink size={14} />
              Open in new window
            </button>
          )}
          {standalone ? (
            <a
              href={`/chats/${sessionId}`}
              className="artifact-close"
              aria-label="Return to conversation"
            >
              <X size={18} />
            </a>
          ) : (
            <button aria-label="Close artifact review" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>
      </header>
      <div className="artifact-address-row">
        {artifact?.kind === "app" ? (
          <Globe size={16} />
        ) : (
          <FileText size={16} />
        )}
        <input
          aria-label="Artifact address"
          value={address}
          readOnly
          title={address}
        />
        <button
          disabled={!connection}
          title="Reload preview; saved drafts remain"
          aria-label="Reload artifact"
          onClick={() => {
            setReady(false);
            setError("");
            if (frame.current && connection) frame.current.src = connection.url;
          }}
        >
          <RotateCw size={16} />
        </button>
        <button disabled={!artifact} onClick={() => void original()}>
          Open original
          <ExternalLink size={13} />
        </button>
      </div>
      <div className="artifact-controls">
        <select
          aria-label="Review artifact"
          value={artifactId}
          onChange={(e) => {
            setArtifactId(e.target.value);
          }}
        >
          {!artifact && <option value="">Choose an artifact</option>}
          {state.artifacts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <div className="artifact-mode">
          <button
            aria-pressed={!pointing}
            disabled={!ready}
            onClick={() => {
              setPointing(false);
              post("mode", { pointing: false });
            }}
          >
            Use {artifact?.kind === "app" ? "app" : "document"}
          </button>
          <button
            aria-pressed={pointing}
            disabled={!ready}
            onClick={() => {
              setPointing(true);
              post("mode", { pointing: true });
            }}
          >
            <MousePointer2 size={14} />
            Point to comment
          </button>
        </div>
        <button
          disabled={!artifact || sending}
          onClick={() =>
            ready
              ? post("page-comment")
              : select({
                  kind: "page",
                  quote: `Page: ${currentRoute || (artifact?.kind === "app" ? new URL(artifact.location).pathname : "/" + artifact?.location)}`,
                  prefix: "",
                  suffix: "",
                  selector: "",
                  route:
                    currentRoute ||
                    (artifact?.kind === "app"
                      ? new URL(artifact.location).pathname
                      : "/" + artifact?.location),
                  documentRevision: revision,
                })
          }
        >
          <MessageSquarePlus size={14} />
          Comment on this page
        </button>
      </div>
      {(error || queue.error || queue.warning || overall.error) && (
        <div className="artifact-notice" role="status">
          <span>{queue.error || overall.error || error || queue.warning}</span>
          <button
            onClick={() => {
              setError("");
              queue.warning = "";
              void Promise.all([queue.flush(), overall.flush()])
                .then(refresh)
                .catch(() => {});
            }}
          >
            Retry / refresh
          </button>
        </div>
      )}
      <div className="artifact-body">
        <section className="artifact-canvas" aria-label="Artifact preview">
          {connection && connection.artifactId === artifactId ? (
            <iframe
              ref={frame}
              src={connection.url}
              title="Review artifact content"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="artifact-empty">
              <FileText size={36} />
              <h2>
                {artifact
                  ? "Opening preview…"
                  : "Review where the ideas happen"}
              </h2>
              <p>
                {artifact
                  ? "Connecting without changing your source files."
                  : "Click a Markdown, HTML, or local-app link in the agent’s reply. It opens here, ready for feedback—no paths or URLs to paste."}
              </p>
            </div>
          )}
        </section>
        <aside className="artifact-feedback" aria-label="Artifact feedback">
          <div className="artifact-feedback-heading">
            <h2>
              Comments <span>{draftComments.length} attached</span>
            </h2>
            <p>
              {pointing
                ? "Click an element to comment, not activate it."
                : "Select text, point to an element, or comment on this page."}
            </p>
          </div>
          {[currentComments, previousComments].map((group, groupIndex) => {
            const cards = group.map((c, i) => (
              <article
                key={c.id}
                data-artifact-comment={c.id}
                className={`artifact-comment ${activeId === c.id ? "active" : ""}`}
              >
                <div className="artifact-comment-meta">
                  <span>
                    {i + 1} ·{" "}
                    {c.delivery === "sent"
                      ? "Sent"
                      : c.delivery === "submitting"
                        ? "Sending…"
                        : c.saved === false || !c.text
                          ? "Writing"
                          : "Saved"}
                  </span>
                  <small>
                    {c.artifactId !== artifactId
                      ? "Other artifact"
                      : status[c.id] === "changed"
                        ? "Original target changed"
                        : status[c.id] === "other-route"
                          ? "On another screen"
                          : status[c.id] === "found"
                            ? "Target found"
                            : "Saved context"}
                  </small>
                </div>
                <button
                  className="artifact-comment-source"
                  onClick={() => setArtifactId(c.artifactId)}
                >
                  {c.anchor.kind === "page"
                    ? "Page"
                    : c.anchor.kind === "text"
                      ? "Text"
                      : "Element"}{" "}
                  ·{" "}
                  {state.artifacts.find((a) => a.id === c.artifactId)?.title ??
                    "Artifact"}
                </button>
                <button
                  className="artifact-quote"
                  onClick={() => {
                    setActiveId(c.id);
                    if (c.artifactId !== artifactId)
                      setArtifactId(c.artifactId);
                    else post("locate", { anchor: c.anchor });
                  }}
                  title="Locate original target"
                >
                  {c.anchor.quote || "Whole page"}
                </button>
                <small className="artifact-target-path" title={c.anchor.route}>
                  {c.anchor.route}
                </small>
                {c.delivery === "draft" && (c.saved === false || !c.text) ? (
                  <textarea
                    aria-label={`Feedback ${i + 1}`}
                    maxLength={20000}
                    placeholder="What would you change or explore?"
                    value={c.text}
                    disabled={sending}
                    onChange={(e) =>
                      edit({ ...c, text: e.target.value, saved: false })
                    }
                    onFocus={() => setActiveId(c.id)}
                    onKeyDown={(e) => {
                      if (
                        (e.metaKey || e.ctrlKey) &&
                        e.key === "Enter" &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!sending && !e.repeat) void saveComment(c);
                      }
                    }}
                  />
                ) : (
                  <p className="artifact-comment-text">{c.text}</p>
                )}
                <div className="artifact-comment-actions">
                  {c.delivery === "draft" &&
                    (c.saved === false || !c.text ? (
                      <button
                        disabled={!c.text.trim() || sending}
                        title="Save comment (⌘Enter or Ctrl+Enter)"
                        aria-keyshortcuts="Meta+Enter Control+Enter"
                        onClick={() => void saveComment(c)}
                      >
                        Save
                      </button>
                    ) : (
                      <button
                        disabled={sending}
                        onClick={() => {
                          edit({ ...c, saved: false });
                          setActiveId(c.id);
                          requestAnimationFrame(() =>
                            document
                              .querySelector<HTMLTextAreaElement>(
                                `[data-artifact-comment="${c.id}"] textarea`,
                              )
                              ?.focus(),
                          );
                        }}
                      >
                        Edit
                      </button>
                    ))}
                  {deleteId === c.id ? (
                    <>
                      <span>Delete annotation?</span>
                      <button disabled={sending} onClick={() => void remove(c)}>
                        Delete
                      </button>
                      <button onClick={() => setDeleteId("")}>Keep</button>
                    </>
                  ) : (
                    <button
                      disabled={sending || c.delivery === "submitting"}
                      onClick={() => setDeleteId(c.id)}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </article>
            ));
            return groupIndex === 0 ? (
              <div key="current" className="artifact-comment-list">
                {!currentComments.length && (
                  <div className="artifact-comments-empty">
                    <MessageSquarePlus size={24} />
                    <p>
                      Keep the thought.
                      <br />
                      Leave it right here.
                    </p>
                    <small>
                      Drafts stay with this conversation—even if the artifact
                      changes.
                    </small>
                  </div>
                )}
                {cards}
              </div>
            ) : group.length > 0 ? (
              <details
                key="previous"
                className="artifact-history"
                open={historyOpen}
                onToggle={(e) => setHistoryOpen(e.currentTarget.open)}
              >
                <summary title={`Previous feedback for ${pageRoute}`}>
                  Previous feedback ({group.length})
                </summary>
                <p>Previously sent for this page. Not attached again.</p>
                {historyOpen && cards}
              </details>
            ) : null;
          })}
          <footer className="artifact-send">
            <label htmlFor="artifact-overall">Overall feedback</label>
            <textarea
              id="artifact-overall"
              aria-label="Overall feedback"
              maxLength={20000}
              value={overall.text}
              disabled={sending}
              placeholder="Thoughts about the whole review…"
              onChange={(e) => editOverall(e.target.value)}
            />
            {overall.conflict && (
              <div className="artifact-overall-conflict">
                <p>Other window’s version:</p>
                <pre>{overall.otherText || "(empty)"}</pre>
                <button
                  onClick={() => {
                    overall.keepMine();
                    void overall.flush().catch(() => {});
                  }}
                >
                  Keep my text
                </button>
                <button onClick={() => overall.useOther()}>
                  Use other version
                </button>
              </div>
            )}
            {!!overall.recovered.length && (
              <details>
                <summary>
                  Recovered overall drafts ({overall.recovered.length})
                </summary>
                {overall.recovered.map((r) => (
                  <div key={r.key}>
                    <pre>{r.value.text}</pre>
                    <button
                      onClick={() => {
                        overall.restore(r);
                        void overall.flush().catch(() => {});
                      }}
                    >
                      Append to my feedback
                    </button>
                    <button onClick={() => overall.removeRecovery(r)}>
                      Delete recovered version
                    </button>
                  </div>
                ))}
              </details>
            )}
            <span className="artifact-attached-count">
              {draftComments.length} comment
              {draftComments.length === 1 ? "" : "s"} attached
              {unfinished.length ? ` · ${unfinished.length} unfinished` : ""}
            </span>
            <span role="status">
              {queue.dirty || overall.dirty
                ? "Saving recovery drafts…"
                : "Saved in this conversation"}
            </span>
            <button
              className="primary"
              disabled={!canSend}
              onClick={() => void send()}
            >
              {sending ? "Sending…" : "Send feedback"}
            </button>
            <small role="status">{sendBlockReason}</small>
          </footer>
        </aside>
      </div>
    </>
  );
  return standalone ? (
    <main className="artifact-window artifact-standalone">{content}</main>
  ) : (
    <dialog
      ref={dialog}
      className="artifact-window"
      aria-label="Artifact review"
      onPointerDown={(e) => {
        pressedBackdrop.current = e.button === 0 && isReviewBackdrop(e);
      }}
      onPointerCancel={() => {
        pressedBackdrop.current = false;
      }}
      onClick={(e) => {
        const dismiss = pressedBackdrop.current && isReviewBackdrop(e);
        pressedBackdrop.current = false;
        if (dismiss) onClose?.();
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      {content}
    </dialog>
  );
}
