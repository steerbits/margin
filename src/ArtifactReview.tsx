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
      },
    }),
  );
}
export function ArtifactLauncher({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false),
    [artifactId, setArtifactId] = useState<string>();
  useEffect(() => {
    const listener = (event: Event) => {
      const e = event as CustomEvent<{
        sessionId: string;
        artifactId?: string;
      }>;
      if (e.detail.sessionId !== sessionId) return;
      e.preventDefault();
      setArtifactId(e.detail.artifactId);
      setOpen(true);
    };
    window.addEventListener("margin:artifact-review", listener);
    return () => window.removeEventListener("margin:artifact-review", listener);
  }, [sessionId]);
  return (
    <>
      <button onClick={() => setOpen(true)}>
        <FileText size={16} />
        Artifacts
      </button>
      {open && (
        <ArtifactReviewWindow
          sessionId={sessionId}
          initialArtifactId={artifactId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function ArtifactReviewWindow({
  sessionId,
  initialArtifactId,
  onClose,
  standalone = false,
}: {
  sessionId: string;
  initialArtifactId?: string;
  onClose?: () => void;
  standalone?: boolean;
}) {
  const [state, setState] = useState<ArtifactReview & { busy: boolean }>({
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
  const [input, setInput] = useState(""),
    [adding, setAdding] = useState(false),
    [registering, setRegistering] = useState(false);
  const [pointing, setPointing] = useState(false),
    [ready, setReady] = useState(false);
  const [currentRoute, setCurrentRoute] = useState(""),
    [revision, setRevision] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [activeId, setActiveId] = useState(""),
    [retargetId, setRetargetId] = useState("");
  const [deleteId, setDeleteId] = useState(""),
    [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const drafts = useRef<ArtifactDrafts | null>(null);
  if (!drafts.current)
    drafts.current = new ArtifactDrafts(
      sessionId,
      localStorage,
      (c) => saveArtifactComment(sessionId, c),
      () => setTick((n) => n + 1),
    );
  const queue = drafts.current;
  const dialog = useRef<HTMLDialogElement>(null),
    frame = useRef<HTMLIFrameElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const artifact = state.artifacts.find((a) => a.id === artifactId);
  const comments = queue
    .merge(state.comments)
    .filter((c) => !c.deleted && c.artifactId === artifactId);
  const draftComments = comments.filter(
    (c) => c.delivery === "draft" && c.text.trim(),
  );
  const latest = useRef({ artifact, comments, pointing, retargetId });
  latest.current = { artifact, comments, pointing, retargetId };
  async function refresh() {
    const next = await api<ArtifactReview & { busy: boolean }>(
      `/sessions/${sessionId}/artifacts`,
    );
    setState(next);
    setLoaded(true);
    setArtifactId((id) => id || next.artifacts.at(-1)?.id || "");
  }
  useEffect(() => {
    let disposed = false;
    const update = () => {
      if (!disposed) void refresh().catch((e) => setError(e.message));
    };
    update();
    const timer = setInterval(update, 1500);
    void queue.flush().catch(() => {});
    const leaving = (e: BeforeUnloadEvent) => {
      if (queue.dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leaving);
    return () => {
      disposed = true;
      clearInterval(timer);
      clearTimeout(saveTimer.current);
      window.removeEventListener("beforeunload", leaving);
      void queue.flush().catch(() => {});
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
      void queue.flush().catch(() => {});
    }, 300);
  }
  function select(anchor: ArtifactAnchor) {
    const current = latest.current;
    if (!current.artifact) return;
    const existing =
      current.comments.find(
        (c) => c.id === current.retargetId && c.delivery === "draft",
      ) ?? current.comments.find((c) => c.delivery === "draft" && !c.text);
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
          createdAt: Date.now(),
        };
    edit(comment);
    setActiveId(comment.id);
    setRetargetId("");
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
          comments: latest.current.comments.map((c) => ({
            id: c.id,
            anchor: c.anchor,
          })),
        });
      } else if (
        data.type === "selected" &&
        data.anchor &&
        typeof data.anchor.quote === "string" &&
        data.anchor.quote.length <= 10000 &&
        ["element", "text"].includes(data.anchor.kind)
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
      comments: comments.map((c) => ({ id: c.id, anchor: c.anchor })),
    });
  }, [connection, state.comments, tick]);
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
  async function register(e: React.FormEvent) {
    e.preventDefault();
    setRegistering(true);
    setError("");
    try {
      const added = await api<Artifact>(`/sessions/${sessionId}/artifacts`, {
        location: input,
      });
      await refresh();
      setArtifactId(added.id);
      setAdding(false);
      setInput("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRegistering(false);
    }
  }
  async function send() {
    setSending(true);
    setError("");
    try {
      await queue.flush();
      const ids = queue
        .merge(state.comments)
        .filter(
          (c) =>
            !c.deleted &&
            c.artifactId === artifactId &&
            c.delivery === "draft" &&
            c.text.trim(),
        )
        .map((c) => c.id);
      await api(`/sessions/${sessionId}/artifacts/send`, {
        id: crypto.randomUUID(),
        commentIds: ids,
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
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
            setRetargetId("");
          }}
        >
          {!artifact && <option value="">Choose an artifact</option>}
          {state.artifacts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
        <button onClick={() => setAdding(!adding)}>+ Open file or app</button>
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
          disabled={!artifact}
          onClick={() =>
            select({
              kind: "page",
              quote: artifact?.title ?? "",
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
          Page comment
        </button>
      </div>
      {(adding || (loaded && !state.artifacts.length)) && (
        <form className="artifact-add" onSubmit={register}>
          <label htmlFor="artifact-location">Generated file or local app</label>
          <input
            id="artifact-location"
            placeholder="reports/summary.md or http://127.0.0.1:3000"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            autoFocus
          />
          <button className="primary" disabled={!input.trim() || registering}>
            {registering ? "Opening…" : "Open for review"}
          </button>
          <small>
            Only files inside this workspace and generated local apps. Original
            files are never modified.
          </small>
        </form>
      )}
      {(error || queue.error || queue.warning) && (
        <div className="artifact-notice" role="status">
          <span>{queue.error || error || queue.warning}</span>
          <button
            onClick={() => {
              setError("");
              queue.warning = "";
              void queue
                .flush()
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
              sandbox="allow-scripts allow-same-origin allow-forms"
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
                  : "Open a Markdown file, an HTML page, or your running local app. Select a passage or point to an element, then send your thoughts together."}
              </p>
            </div>
          )}
        </section>
        <aside className="artifact-feedback" aria-label="Artifact feedback">
          <div className="artifact-feedback-heading">
            <h2>
              Feedback <span>{comments.length}</span>
            </h2>
            <p>
              {retargetId
                ? "Select the replacement target in the artifact."
                : pointing
                  ? "Click an element to comment, not activate it."
                  : "Select text, or use Point to comment."}
            </p>
          </div>
          <div className="artifact-comment-list">
            {!comments.length && (
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
            {comments.map((c, i) => (
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
                        : "Draft"}
                  </span>
                  <small>
                    {status[c.id] === "changed"
                      ? "Original target changed"
                      : status[c.id] === "other-route"
                        ? "On another screen"
                        : status[c.id] === "found"
                          ? "Target found"
                          : "Saved context"}
                  </small>
                </div>
                <button
                  className="artifact-quote"
                  onClick={() => {
                    setActiveId(c.id);
                    post("locate", { anchor: c.anchor });
                  }}
                  title="Locate original target"
                >
                  {c.anchor.quote || "Whole page"}
                </button>
                <small className="artifact-target-path" title={c.anchor.route}>
                  {c.anchor.route}
                </small>
                {c.delivery === "draft" ? (
                  <textarea
                    aria-label={`Feedback ${i + 1}`}
                    maxLength={20000}
                    placeholder="What would you change or explore?"
                    value={c.text}
                    disabled={sending}
                    onChange={(e) => edit({ ...c, text: e.target.value })}
                    onFocus={() => setActiveId(c.id)}
                  />
                ) : (
                  <p className="artifact-comment-text">{c.text}</p>
                )}
                <div className="artifact-comment-actions">
                  {c.delivery === "draft" && (
                    <button
                      disabled={!ready || sending}
                      onClick={() => {
                        setRetargetId(c.id);
                        setPointing(true);
                        post("mode", { pointing: true });
                      }}
                    >
                      Retarget
                    </button>
                  )}
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
            ))}
          </div>
          <footer className="artifact-send">
            <span role="status">
              {queue.dirty ? "Saving drafts…" : "Saved in this conversation"}
            </span>
            <button
              className="primary"
              disabled={state.busy || sending || !draftComments.length}
              onClick={() => void send()}
            >
              {sending
                ? "Sending…"
                : `Send ${draftComments.length || ""} comment${draftComments.length === 1 ? "" : "s"}`}
            </button>
            <small>
              {state.busy
                ? "Agent is working. Keep reviewing; send when ready."
                : "Agent is ready · sends to this conversation"}
            </small>
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
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      {content}
    </dialog>
  );
}
