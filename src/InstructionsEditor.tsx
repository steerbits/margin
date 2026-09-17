import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { InstructionsView } from "../shared/instructions.ts";
import { api, ApiError } from "./api.ts";
import type { LeaveGuard } from "./leave-guard.ts";
import "./Instructions.css";

type Intent = "close" | "leave" | "reload";
export function InstructionsEditor({
  endpoint,
  scope,
  workspaceName,
  guard,
}: {
  endpoint: string;
  scope: "global" | "workspace";
  workspaceName?: string;
  guard: LeaveGuard;
}) {
  const id = useId();
  const owner = useRef(Symbol("instructions")).current;
  const [view, setView] = useState<InstructionsView | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState("");
  const [intent, setIntent] = useState<Intent | null>(null);
  const pendingLeave = useRef<((allow: boolean) => void) | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const dirty = editing && !!view && draft !== view.content;
  const title =
    scope === "global" ? "Global instructions" : "Workspace instructions";
  const target =
    scope === "global"
      ? "global instructions"
      : `${workspaceName ?? "this workspace"}’s instructions`;

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError("");
    try {
      const value = await api<InstructionsView>(
        endpoint,
        undefined,
        "GET",
        signal,
      );
      if (!mounted.current || signal?.aborted) return;
      setView(value);
      setDraft(value.content);
      setConflict(false);
      setIntent(null);
    } catch (e) {
      if (mounted.current && !signal?.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current && !signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      mounted.current = false;
      controller.abort();
      pendingLeave.current?.(false);
      pendingLeave.current = null;
      guard.release(owner);
    };
  }, [endpoint]);
  useLayoutEffect(() => {
    if (!dirty && !saving && !(editing && loading)) return;
    return guard.register(owner, () => {
      if (saving || loading || pendingLeave.current)
        return Promise.resolve(false);
      setIntent("leave");
      return new Promise<boolean>((resolve) => {
        pendingLeave.current = resolve;
      });
    });
  }, [dirty, saving, editing, loading, guard, owner]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);
  useLayoutEffect(() => {
    if (!editing) return;
    textarea.current?.focus({ preventScroll: true });
    // Reveal the whole edit group, including its separate footer. Focusing
    // only the textarea can leave the save controls below a narrow viewport.
    textarea.current?.parentElement?.scrollIntoView({ block: "nearest" });
  }, [editing]);
  useLayoutEffect(() => {
    if (!intent) return;
    footer.current?.scrollIntoView({ block: "nearest" });
    keepButton.current?.focus({ preventScroll: true });
  }, [intent]);
  function settleLeave(allow: boolean) {
    const resolve = pendingLeave.current;
    pendingLeave.current = null;
    resolve?.(allow);
  }
  function keepEditing() {
    settleLeave(false);
    setIntent(null);
    textarea.current?.focus({ preventScroll: true });
  }
  function collapse(leave = false) {
    guard.release(owner);
    setEditing(false);
    setIntent(null);
    setError("");
    setConflict(false);
    if (view) setDraft(view.content);
    settleLeave(leave);
    // Discarding a stale draft must show the external writer's current file,
    // not the old preview (which may even say that no file exists).
    if (!leave)
      void load().then(() =>
        requestAnimationFrame(() =>
          editButton.current?.focus({ preventScroll: true }),
        ),
      );
  }
  async function save() {
    if (!view || saving || !dirty || conflict) return;
    setSaving(true);
    setError("");
    try {
      const value = await api<InstructionsView>(
        endpoint,
        { content: draft, revision: view.revision },
        "PUT",
      );
      if (!mounted.current) return;
      setView(value);
      setDraft(value.content);
      setNotice(
        "Saved. Updated instructions will be loaded starting with the next message; work already running is unaffected.",
      );
      const leaving = intent === "leave";
      guard.release(owner);
      setEditing(false);
      setIntent(null);
      settleLeave(leaving);
      if (!leaving)
        requestAnimationFrame(() =>
          editButton.current?.focus({ preventScroll: true }),
        );
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setConflict(e instanceof ApiError && e.status === 409);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  function close() {
    if (saving || loading) return;
    if (dirty) setIntent("close");
    else collapse();
  }
  return (
    <section
      className={`instructions-card${editing ? " instructions-editing" : ""}`}
      aria-labelledby={`${id}-title`}
    >
      <div className="instructions-heading">
        <h2 id={`${id}-title`}>
          {title}
          {scope === "workspace" && workspaceName ? ` · ${workspaceName}` : ""}
        </h2>
        {!editing && view && (
          <button
            ref={editButton}
            disabled={!!view.blockedReason || loading || !!error}
            onClick={() => {
              setEditing(true);
              setNotice("");
              setError("");
            }}
          >
            {view.exists ? "Edit" : "Add instructions"}
          </button>
        )}
      </div>
      <p className="instructions-help">
        {scope === "global"
          ? "Used across all workspaces in this Margin installation."
          : "Additional guidance for work in this workspace."}
      </p>
      {view && <code className="instructions-path">{view.path}</code>}
      {view?.blockedReason && (
        <p className="instructions-warning" role="alert">
          {view.blockedReason}
        </p>
      )}
      {loading && <p role="status">Loading instructions…</p>}
      {!editing &&
        view &&
        !loading &&
        !error &&
        (view.content ? (
          <pre className="instructions-preview">
            {view.content.slice(0, 1200)}
            {view.content.length > 1200 ? "\n…" : ""}
          </pre>
        ) : (
          <p className="instructions-empty">
            {view.exists
              ? "This file is empty."
              : `No ${scope} instructions yet.`}
          </p>
        ))}
      {editing && view && (
        <div
          className="instructions-edit-body"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (intent) keepEditing();
              else close();
            }
          }}
        >
          <p className="instructions-help" id={`${id}-help`}>
            Changes aren’t applied until you save. Saved changes are used
            starting with the next message. Work already running is unaffected.
          </p>
          <label className="sr-only" htmlFor={`${id}-text`}>
            {title} Markdown
          </label>
          <textarea
            id={`${id}-text`}
            ref={textarea}
            value={draft}
            spellCheck={false}
            disabled={saving || loading}
            aria-describedby={`${id}-help`}
            onChange={(event) => {
              setDraft(event.target.value);
              setNotice("");
            }}
          />
          <div className="instructions-footer" ref={footer}>
            {error && (
              <div className="instructions-error" role="alert">
                <p>Couldn’t save: {error}</p>
                {conflict && (
                  <button
                    disabled={saving || loading}
                    onClick={() => {
                      settleLeave(false);
                      setIntent("reload");
                    }}
                  >
                    Reload saved file
                  </button>
                )}
              </div>
            )}
            {intent === "reload" ? (
              <>
                <p>
                  Replace your draft with the saved file? Copy anything you want
                  to keep first.
                </p>
                <div className="instructions-actions">
                  <button
                    ref={keepButton}
                    onClick={keepEditing}
                    disabled={loading}
                  >
                    Keep editing
                  </button>
                  <button
                    disabled={loading}
                    onClick={() =>
                      void load().then(() => textarea.current?.focus())
                    }
                  >
                    Replace draft
                  </button>
                </div>
              </>
            ) : intent ? (
              <>
                <p>Unsaved changes to {target}.</p>
                <div className="instructions-actions">
                  <button
                    ref={keepButton}
                    onClick={keepEditing}
                    disabled={saving}
                  >
                    Keep editing
                  </button>
                  <button
                    onClick={() => collapse(intent === "leave")}
                    disabled={saving}
                  >
                    {intent === "leave"
                      ? "Discard and leave"
                      : "Discard changes"}
                  </button>
                  <button
                    className="primary"
                    onClick={() => void save()}
                    disabled={saving || loading || conflict || !dirty}
                  >
                    {saving
                      ? "Saving…"
                      : intent === "leave"
                        ? "Save and leave"
                        : "Save and close"}
                  </button>
                </div>
              </>
            ) : (
              <div className="instructions-actions">
                <span role="status">
                  {saving
                    ? "Saving…"
                    : dirty
                      ? "Unsaved changes"
                      : "No unsaved changes"}
                </span>
                <button onClick={close} disabled={saving || loading}>
                  Close
                </button>
                <button
                  className="primary"
                  onClick={() => void save()}
                  disabled={!dirty || saving || loading || conflict}
                >
                  {saving
                    ? "Saving…"
                    : error
                      ? "Retry saving"
                      : "Save and close"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {!editing && error && (
        <div className="instructions-error" role="alert">
          <p>{error}</p>
          <button onClick={() => void load()}>Retry loading</button>
        </div>
      )}
      {!editing && notice && (
        <p className="instructions-help" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
