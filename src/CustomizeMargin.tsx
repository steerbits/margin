import {
  useEffect,
  useState,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock3,
  Code2,
  Copy,
  Layers,
  Plug,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { api } from "./api.ts";
import {
  customizationExamples,
  type CheckpointPreview,
  type HistoryState,
  type PluginInfo,
} from "../shared/customization.ts";
import type { Project } from "../shared/types.ts";
import type { CustomizeTab } from "../shared/navigation.ts";
import "./CustomizeMargin.css";

type Hub = { project: Project; plugins: PluginInfo[]; history: HistoryState };
export function CustomizeMargin({
  onClose,
  onPrompt,
  tab,
  onTabChange,
}: {
  onClose: () => void;
  onPrompt: (project: Project, prompt: string) => Promise<void>;
  tab: CustomizeTab;
  onTabChange: (tab: CustomizeTab) => void;
}) {
  const [data, setData] = useState<Hub | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [preview, setPreview] = useState<CheckpointPreview | null>(null);
  const [changingPlugin, setChangingPlugin] = useState<string | null>(null);
  const load = async () => {
    const result = await api<Hub>("/customize");
    setData(result);
    return result;
  };
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function inspect(id: string) {
    await run(async () =>
      setPreview(
        await api<CheckpointPreview>(`/customize/checkpoints/${id}/preview`),
      ),
    );
  }
  function togglePlugin(plugin: PluginInfo, enabled: boolean) {
    setChangingPlugin(plugin.id);
    setData((d) =>
      d
        ? {
            ...d,
            plugins: d.plugins.map((p) =>
              p.id === plugin.id ? { ...p, enabled } : p,
            ),
          }
        : d,
    );
    void run(async () => {
      try {
        await api(`/customize/plugins/${plugin.id}`, { enabled });
        const refreshed = await load();
        setNotice(
          refreshed.plugins.some((p) => p.enabled !== p.active)
            ? "Plugin preference saved. Restart the server and refresh the browser to apply it."
            : "Plugin preferences match the running app. No restart is needed.",
        );
      } catch (error) {
        setData((d) =>
          d
            ? {
                ...d,
                plugins: d.plugins.map((p) =>
                  p.id === plugin.id ? { ...p, enabled: plugin.enabled } : p,
                ),
              }
            : d,
        );
        throw error;
      } finally {
        setChangingPlugin(null);
      }
    });
  }
  return (
    <div className="customize-page">
      <div className="customize-header">
        <div>
          <div className="customize-eyebrow">
            <Code2 size={15} /> YOUR APP WORKSPACE
          </div>
          <h1>Customize Margin</h1>
          <p>
            Try a focused change. Keep the versions you want to come back to.
          </p>
        </div>
        <button onClick={onClose}>
          <ArrowLeft size={16} />
          Back to conversation
        </button>
      </div>
      {error && !preview && (
        <div className="notice error" role="alert">
          {error}
          {data && (
            <button
              onClick={() => setError("")}
              aria-label="Dismiss customization error"
            >
              <X size={15} />
            </button>
          )}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss customization notice"
          >
            <X size={15} />
          </button>
        </div>
      )}
      {data && (
        <div className="source-location">
          <span>Margin source</span>
          <code>{data.project.path}</code>
          <button
            disabled={busy}
            onClick={() => void run(() => onPrompt(data.project, ""))}
          >
            Start customization chat
            <ArrowRight size={15} />
          </button>
        </div>
      )}
      <nav className="customize-tabs" aria-label="Customization sections">
        {(["examples", "plugins", "history"] as const).map((t) => (
          <button
            key={t}
            aria-current={tab === t ? "page" : undefined}
            onClick={() => onTabChange(t)}
          >
            {t === "examples" ? (
              <Layers size={17} />
            ) : t === "plugins" ? (
              <Plug size={17} />
            ) : (
              <Clock3 size={17} />
            )}{" "}
            {t[0].toUpperCase() + t.slice(1)}
            {t === "plugins" && data ? (
              <span className="count">{data.plugins.length}</span>
            ) : null}
          </button>
        ))}
      </nav>
      {!data ? (
        error ? (
          <button
            onClick={() =>
              void run(async () => {
                await load();
              })
            }
          >
            Try again
          </button>
        ) : (
          <p className="muted">Loading customization workspace…</p>
        )
      ) : tab === "examples" ? (
        <>
          <p className="customize-intro">
            Choose an example to prepare a prompt. You decide when to send it.
            Margin saves a code checkpoint before customization messages.
          </p>
          <div className="example-grid">
            {customizationExamples.map((e) => (
              <article className="example-card" key={e.id}>
                <h2>{e.title}</h2>
                <p>{e.description}</p>
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      onPrompt(
                        data.project,
                        `Read docs/extensions.md and use the existing plugin APIs where they fit. Keep the change focused, verify it, and tell me when a rebuild or restart is needed. Do not restart the running server yourself.\n\n${e.prompt}`,
                      ),
                    )
                  }
                >
                  Use this prompt
                  <ArrowRight size={15} />
                </button>
              </article>
            ))}
          </div>
        </>
      ) : tab === "plugins" ? (
        <>
          <p className="customize-intro">
            Plugins are installed in Margin's source. On/off settings apply to
            the whole app after a server restart and browser refresh. Saved
            plugin data stays in place.
          </p>
          <div className="installed-plugins">
            {data.plugins.map((p) => (
              <article className="installed-plugin" key={p.id}>
                <div>
                  <h2>{p.name}</h2>
                  <p>{p.description}</p>
                  <code>plugins/{p.id}/</code>
                  <div className="plugin-capabilities">
                    {p.browser && <span>Browser UI</span>}
                    {p.server && <span>Server</span>}
                  </div>
                  {p.error && (
                    <p role="alert" className="error-text">
                      {p.error}
                    </p>
                  )}
                </div>
                <div className="plugin-switch">
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`Enable ${p.name}`}
                      checked={p.enabled}
                      disabled={busy}
                      onChange={(e) => togglePlugin(p, e.target.checked)}
                    />
                    {p.enabled ? "On" : "Off"}
                  </label>
                  <span>
                    {changingPlugin === p.id
                      ? "Saving…"
                      : p.enabled !== p.active
                        ? "Restart needed"
                        : p.error
                          ? "Not loaded"
                          : p.active
                            ? "Active"
                            : "Disabled"}
                  </span>
                </div>
              </article>
            ))}
            {!data.plugins.length && (
              <p className="muted">
                No local plugins installed yet. Start with an example.
              </p>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="customize-intro">
            Checkpoints save source code and plugin settings. Chats, notes,
            credentials, generated files, and ordinary workspaces are excluded.
            Restoring keeps every checkpoint and saves the current code first.
          </p>
          {!data.history.available ? (
            <div className="notice error">{data.history.error}</div>
          ) : (
            <>
              {data.history.error && (
                <div className="notice error" role="alert">
                  {data.history.error}
                </div>
              )}
              {data.history.activationPending && (
                <div className="notice">
                  Source files have been restored. Rebuild and restart the
                  server to activate them. You can still return to the saved
                  pre-restore state here.
                </div>
              )}
              <form
                className="checkpoint-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await api("/customize/checkpoints", { name });
                    setName("");
                    setNotice("Checkpoint saved.");
                    await load();
                  });
                }}
              >
                <input
                  aria-label="Checkpoint name"
                  placeholder="Name a checkpoint, e.g. Before task board"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                />
                <button className="primary" disabled={busy || !name.trim()}>
                  <Save size={15} />
                  Save checkpoint
                </button>
              </form>
              {data.history.returnToId && (
                <button
                  className="return-checkpoint"
                  disabled={busy}
                  onClick={() => void inspect(data.history.returnToId!)}
                >
                  <RefreshCw size={16} />
                  Return to before the last restore
                  <span className="return-destination">
                    {
                      data.history.checkpoints.find(
                        (c) => c.id === data.history.returnToId,
                      )?.name
                    }
                  </span>
                </button>
              )}
              <div className="checkpoint-list">
                {data.history.checkpoints.map((c) => (
                  <article key={c.id}>
                    <div>
                      <h2>{c.name}</h2>
                      <p>
                        {new Date(c.createdAt).toLocaleString()} ·{" "}
                        {c.kind === "manual"
                          ? "Saved by you"
                          : c.kind === "before-restore"
                            ? "Saved before restore"
                            : "Automatic checkpoint"}
                        {data.history.currentId === c.id
                          ? " · Last restored"
                          : ""}
                      </p>
                    </div>
                    <button disabled={busy} onClick={() => void inspect(c.id)}>
                      Preview changes
                      <ArrowRight size={15} />
                    </button>
                  </article>
                ))}
                {!data.history.checkpoints.length && (
                  <div className="history-empty">
                    <Clock3 size={26} />
                    <h2>No checkpoints yet</h2>
                    <p>
                      Save the current working version, or start a customization
                      chat to create one automatically.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
          <details className="recovery-details">
            <summary>Recover even if the interface breaks</summary>
            <p>
              This standalone command lives outside the source files covered by
              checkpoints. It can list, preview, and restore saved versions from
              Terminal.
            </p>
            <code>{data.history.recoveryCommand}</code>
            <button
              onClick={() =>
                void navigator.clipboard
                  .writeText(data.history.recoveryCommand)
                  .then(() => setNotice("Recovery command copied."))
                  .catch((e) => setError(e.message))
              }
            >
              <Copy size={14} />
              Copy command
            </button>
          </details>
        </>
      )}
      {preview && (
        <CheckpointModal
          busy={busy}
          onClose={() => {
            setPreview(null);
            setError("");
          }}
        >
          <div className="rail-heading">
            <h2>Restore “{preview.checkpoint.name}”?</h2>
            <button
              disabled={busy}
              aria-label="Close checkpoint preview"
              onClick={() => setPreview(null)}
            >
              <X size={18} />
            </button>
          </div>
          <p>
            This is a file-change preview, not a running preview. Your current
            code will be saved first, so you can return to it later.
          </p>
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <div className="checkpoint-files">
            {preview.files.map((f) => (
              <div key={f.path}>
                <span className={`change-${f.change}`}>{f.change}</span>
                <code>{f.path}</code>
              </div>
            ))}
            {!preview.files.length && (
              <p>
                <Check size={16} />
                These source files already match.
              </p>
            )}
          </div>
          {preview.diff && (
            <details open>
              <summary>Code changes</summary>
              <pre>{preview.diff}</pre>
            </details>
          )}
          <div className="preview-actions">
            <button disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                (!preview.files.length &&
                  data?.history.pendingRestoreTarget !== preview.checkpoint.id)
              }
              onClick={() =>
                void run(async () => {
                  const result = await api<{ backup?: { name: string } }>(
                    `/customize/checkpoints/${preview.checkpoint.id}/restore`,
                    { token: preview.token },
                  );
                  setPreview(null);
                  const refreshed = await load();
                  setNotice(
                    `Source restored. ${result.backup ? `Your previous code was saved as “${result.backup.name}”. ` : ""}${refreshed.history.activationPending ? "Rebuild and restart to activate." : "These files match the running source; no restart is needed."}`,
                  );
                })
              }
            >
              Save current state & restore
            </button>
          </div>
        </CheckpointModal>
      )}
    </div>
  );
}

function CheckpointModal({
  children,
  onClose,
  busy,
}: {
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="checkpoint-preview"
      aria-label="Preview checkpoint changes"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
