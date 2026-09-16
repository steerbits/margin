import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Server, CheckCircle2 } from "lucide-react";
import { api } from "./api.ts";
import {
  thinkingHelp,
  type ThinkingOverride,
} from "../shared/model-capabilities.ts";
import { thinkingLevels, thinkingLabel } from "../shared/settings.ts";
import {
  customApiFormats,
  type CustomConnectionInput,
  type CustomConnectionView,
  type ConnectionDiscovery,
  type DiscoveredModel,
} from "../shared/custom-connections.ts";

const blank = (): CustomConnectionInput => ({
  api: "openai-completions",
  baseUrl: "",
  authentication: "api_key",
  apiKey: "",
  modelId: "",
});
export function CustomConnectionsPanel({
  onChanged,
  onBusyChange,
  onEditingChange,
  disabled,
  readOnly,
  showAdd = true,
  onCountChange,
}: {
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onEditingChange: (editing: boolean) => void;
  disabled: boolean;
  readOnly: boolean;
  showAdd?: boolean;
  onCountChange?: (count: number) => void;
}) {
  const [connections, setConnections] = useState<CustomConnectionView[]>([]);
  const [draft, setDraft] = useState<CustomConnectionInput>();
  const [models, setModels] = useState<DiscoveredModel[]>([]);
  const [headers, setHeaders] = useState("");
  const [busy, setBusy] = useState<"discover" | "save" | "remove">();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string>();
  const abort = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const form = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChanged, onBusyChange, onEditingChange });
  callbacks.current = { onChanged, onBusyChange, onEditingChange };
  async function load() {
    const result = await api<{ connections: CustomConnectionView[] }>(
      "/custom-connections",
    );
    if (mounted.current) {
      setConnections(result.connections);
      onCountChange?.(result.connections.length);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void load().catch((e) => {
      if (mounted.current) setError(e.message);
    });
    return () => {
      mounted.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    callbacks.current.onBusyChange(!!busy);
  }, [busy]);
  useEffect(() => {
    callbacks.current.onEditingChange(!!draft);
  }, [!!draft]);
  useEffect(() => {
    if (draft) form.current?.scrollIntoView({ block: "nearest" });
  }, [!!draft]);
  function edit(connection?: CustomConnectionView) {
    setDraft(
      connection
        ? {
            id: connection.id,
            name: connection.name,
            api: connection.api,
            baseUrl: connection.baseUrl,
            authentication: connection.authentication,
            modelId: connection.modelId,
            apiKey: "",
            ...(connection.contextSource === "manual"
              ? { contextWindow: connection.contextWindow }
              : {}),
            maxTokens:
              connection.maxTokensSource === "automatic"
                ? undefined
                : connection.maxTokens,
            supportsDeveloperRole: connection.supportsDeveloperRole,
            supportsReasoningEffort: connection.supportsReasoningEffort,
            thinking: connection.thinking ?? { mode: "auto" },
          }
        : blank(),
    );
    setModels([]);
    setHeaders("");
    setError("");
    setNotice("");
    setConfirmRemove(undefined);
  }
  function update(change: Partial<CustomConnectionInput>, resetModels = false) {
    setDraft((current) => (current ? { ...current, ...change } : current));
    setError("");
    setNotice("");
    if (resetModels) setModels([]);
  }
  async function act(action: "discover" | "save") {
    if (!draft || busy || disabled || readOnly) return;
    setError("");
    setNotice("");
    setBusy(action);
    abort.current = new AbortController();
    try {
      if (action === "save" && draft.thinking?.mode === "effort" && !draft.thinking.levels?.length)
        throw new Error("Select at least one supported effort level in Advanced.");
      let customHeaders: Record<string, string> | undefined;
      if (headers.trim()) {
        try {
          customHeaders = JSON.parse(headers);
          if (
            !customHeaders ||
            Array.isArray(customHeaders) ||
            typeof customHeaders !== "object" ||
            Object.values(customHeaders).some(
              (value) => typeof value !== "string",
            )
          )
            throw new Error();
        } catch {
          throw new Error(
            'Custom headers must be a JSON object, for example {"X-Team": "engineering"}.',
          );
        }
      }
      const input = {
        ...draft,
        ...(customHeaders ? { headers: customHeaders } : {}),
      };
      if (action === "discover") {
        delete input.thinking;
        delete input.contextWindow;
        delete input.maxTokens;
        const result = await api<ConnectionDiscovery>(
          "/custom-connections/discover",
          input,
          "POST",
          abort.current.signal,
        );
        if (!mounted.current) return;
        setModels(result.models);
        setNotice(
          result.message ??
            `Found ${result.models.length} models. Choose one or enter another model ID.`,
        );
        if (!draft.modelId && result.models.length)
          update({ modelId: result.models[0].id });
      } else {
        const result = await api<{ message: string }>(
          "/custom-connections/save",
          input,
          "POST",
          abort.current.signal,
        );
        if (!mounted.current) return;
        setDraft(undefined);
        setHeaders("");
        setNotice(result.message);
        await load();
        try {
          await callbacks.current.onChanged();
        } catch {
          setError(
            "Connection saved, but models could not refresh. Refresh models before using it.",
          );
        }
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof DOMException && e.name === "AbortError"
            ? "Connection check cancelled."
            : e instanceof Error
              ? e.message
              : "Connection failed.",
        );
    } finally {
      if (mounted.current) setBusy(undefined);
    }
  }
  return (
    <div className="custom-connections">
      {!draft && (
        <>
          {connections.map((connection) => (
            <div className="saved-custom-connection" key={connection.id}>
              <Server size={18} aria-hidden="true" />
              <div>
                <strong>{connection.name}</strong>
                <span>Saved · {connection.modelId}</span>
              </div>
              <button
                type="button"
                disabled={disabled || readOnly}
                onClick={() => edit(connection)}
              >
                Edit
              </button>
              <button
                type="button"
                disabled={disabled || readOnly || !!busy}
                onClick={() => setConfirmRemove(connection.id)}
              >
                Remove
              </button>
              {confirmRemove === connection.id && (
                <div className="account-notice">
                  <p>
                    Remove this connection? Conversations using it will need
                    another model.
                  </p>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => {
                      setBusy("remove");
                      void api(
                        `/custom-connections/${connection.id}`,
                        {},
                        "DELETE",
                      )
                        .then(load)
                        .then(callbacks.current.onChanged)
                        .then(() => setConfirmRemove(undefined))
                        .catch((e) => setError(e.message))
                        .finally(() => setBusy(undefined));
                    }}
                  >
                    Remove connection
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => setConfirmRemove(undefined)}
                  >
                    Keep connection
                  </button>
                </div>
              )}
            </div>
          ))}
          {showAdd && (
            <button
              className="add-custom-connection"
              type="button"
              disabled={disabled || readOnly}
              onClick={() => edit()}
            >
              <Plus size={16} /> Add custom connection{" "}
              <span>Local models or your own server</span>
            </button>
          )}
        </>
      )}
      {draft && (
        <div ref={form} className="custom-connection-form">
          <button
            type="button"
            className="connection-back"
            disabled={!!busy}
            onClick={() => {
              setDraft(undefined);
              setError("");
            }}
          >
            <ArrowLeft size={14} /> Back to connections
          </button>
          <h3>
            {draft.id ? "Edit custom connection" : "Add custom connection"}
          </h3>
          <p className="settings-help">
            Connect a local model or a server provided by your team.
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act("save");
            }}
          >
            <fieldset disabled={!!busy || disabled || readOnly}>
              <label className="account-label">
                API format
                <select
                  aria-label="API format"
                  value={draft.api}
                  onChange={(e) =>
                    update(
                      {
                        api: e.target.value as CustomConnectionInput["api"],
                        thinking: { mode: "auto" },
                        ...(e.target.value === "google-generative-ai"
                          ? { authentication: "api_key" as const }
                          : {}),
                      },
                      true,
                    )
                  }
                >
                  {customApiFormats.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="account-label">
                Base URL
                <input
                  type="url"
                  required
                  value={draft.baseUrl}
                  placeholder="https://your-server.example/v1"
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => update({ baseUrl: e.target.value }, true)}
                />
              </label>
              <label className="account-label">
                Authentication
                <select
                  aria-label="Authentication"
                  value={draft.authentication}
                  onChange={(e) =>
                    update(
                      {
                        authentication: e.target.value as "api_key" | "none",
                        apiKey: "",
                      },
                      true,
                    )
                  }
                >
                  <option value="api_key">API key</option>
                  <option
                    value="none"
                    disabled={draft.api === "google-generative-ai"}
                  >
                    No authentication
                  </option>
                </select>
              </label>
              {draft.api === "google-generative-ai" && (
                <p className="settings-help">
                  This API format requires a key in the current runtime. For a
                  keyless local server, use its OpenAI-compatible API if
                  available.
                </p>
              )}
              {draft.authentication === "api_key" ? (
                <label className="account-label">
                  API key
                  <input
                    type="password"
                    required={!draft.id}
                    value={draft.apiKey ?? ""}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      draft.id
                        ? "Leave blank to keep the saved key"
                        : "Paste your API key"
                    }
                    onChange={(e) => update({ apiKey: e.target.value })}
                  />
                </label>
              ) : (
                <p className="settings-help">
                  Use this only when your server does not require an API key.
                </p>
              )}
              <button
                type="button"
                className="discover-models"
                disabled={!draft.baseUrl}
                onClick={() => void act("discover")}
              >
                {busy === "discover" ? "Finding models…" : "Find models"}
              </button>
              {models.length > 0 && (
                <label className="account-label">
                  Discovered models
                  <select
                    aria-label="Discovered models"
                    value={
                      models.some((m) => m.id === draft.modelId)
                        ? draft.modelId
                        : ""
                    }
                    onChange={(e) => update({ modelId: e.target.value })}
                  >
                    <option value="">Enter a model ID manually</option>
                    {models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="account-label">
                Model ID
                <input
                  required
                  value={draft.modelId}
                  placeholder="Choose a model above or enter its ID"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => update({ modelId: e.target.value })}
                />
              </label>
              <p className="settings-help">
                You can enter a model ID even if your server cannot list models.
              </p>
              <details className="connection-advanced">
                <summary>Advanced</summary>
                <label className="account-label">
                  Connection name
                  <input
                    value={draft.name ?? ""}
                    placeholder="Named automatically from your server"
                    maxLength={100}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label className="account-label">
                  Context size (tokens)
                  <input
                    type="number"
                    min={512}
                    max={10000000}
                    value={draft.contextWindow ?? ""}
                    placeholder="Detect automatically"
                    onChange={(e) =>
                      update({
                        contextWindow: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
                <p className="settings-help">
                  The server's configured limit can be smaller than the model's
                  advertised capacity.
                </p>
                <label className="account-label">
                  Maximum reply tokens
                  <input
                    type="number"
                    min={32}
                    max={1000000}
                    value={draft.maxTokens ?? ""}
                    placeholder="Automatic"
                    onChange={(e) =>
                      update({
                        maxTokens: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
                <label className="account-label">
                  Custom headers
                  <textarea
                    value={headers}
                    rows={3}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={
                      draft.id
                        ? "Saved headers are retained. Enter {} to clear them."
                        : '{"X-Team": "engineering"}'
                    }
                    onChange={(e) => setHeaders(e.target.value)}
                  />
                </label>
                <label className="account-label">
                  Thinking controls
                  <select
                    aria-label="Thinking controls"
                    value={draft.thinking?.mode ?? "auto"}
                    onChange={(e) =>
                      update({
                        thinking: {
                          mode: e.target.value as ThinkingOverride["mode"],
                          transport: "native",
                          ...(e.target.value === "effort"
                            ? { levels: [] }
                            : {}),
                        },
                      })
                    }
                  >
                    <option value="auto">Detect automatically</option>
                    <option value="server">Managed by server / unknown</option>
                    <option value="unsupported">Thinking not supported</option>
                    <option value="toggle">On / off</option>
                    <option value="effort">Specific effort levels</option>
                    <option value="always">Always enabled</option>
                  </select>
                </label>
                <p className="settings-help">
                  Override only with settings documented by your model or
                  server. Unknown controls use Server default; a text reply
                  alone does not verify thinking support.
                </p>
                {draft.id && (
                  <p className="settings-help">
                    {thinkingHelp(
                      connections.find((c) => c.id === draft.id)
                        ?.thinkingControl,
                    )}
                  </p>
                )}
                {["toggle", "effort", "always"].includes(
                  draft.thinking?.mode ?? "",
                ) &&
                  draft.api === "openai-completions" && (
                    <label className="account-label">
                      Thinking API
                      <select
                        aria-label="Thinking API"
                        value={draft.thinking?.transport ?? "native"}
                        onChange={(e) =>
                          update({
                            thinking: {
                              ...draft.thinking!,
                              transport: e.target
                                .value as ThinkingOverride["transport"],
                            },
                          })
                        }
                      >
                        <option value="native">
                          Standard API reasoning control
                        </option>
                        <option value="openrouter">
                          OpenRouter reasoning control
                        </option>
                        <option
                          value="chat-template"
                          disabled={draft.thinking?.mode === "effort"}
                        >
                          Chat-template on/off
                        </option>
                        <option
                          value="llama-cpp"
                          disabled={draft.thinking?.mode === "effort"}
                        >
                          llama.cpp chat-template on/off
                        </option>
                      </select>
                    </label>
                  )}
                {draft.thinking?.mode === "effort" && (
                  <fieldset className="thinking-level-overrides">
                    <legend>Supported effort levels</legend>
                    {thinkingLevels.map((level) => (
                      <label className="connection-checkbox" key={level}>
                        <input
                          type="checkbox"
                          checked={
                            draft.thinking?.levels?.includes(level) ?? false
                          }
                          onChange={(e) =>
                            update({
                              thinking: {
                                ...draft.thinking!,
                                levels: e.target.checked
                                  ? [...(draft.thinking!.levels ?? []), level]
                                  : draft.thinking!.levels?.filter(
                                      (item) => item !== level,
                                    ),
                              },
                            })
                          }
                        />
                        {thinkingLabel(level)}
                      </label>
                    ))}
                  </fieldset>
                )}
                <label className="connection-checkbox">
                  <input
                    type="checkbox"
                    checked={draft.supportsDeveloperRole ?? false}
                    onChange={(e) =>
                      update({ supportsDeveloperRole: e.target.checked })
                    }
                  />
                  Server supports the developer role
                </label>
              </details>
              <button type="submit" className="primary connection-save">
                {busy === "save" ? "Testing connection…" : "Test & save"}
              </button>
              <p className="settings-help">
                Sends a small test message to this server. Provider usage
                charges may apply. Saves only after a reply.
              </p>
            </fieldset>
          </form>
          {busy && (
            <button
              type="button"
              className="connection-back"
              onClick={() => abort.current?.abort()}
            >
              Cancel connection check
            </button>
          )}
        </div>
      )}
      {notice && (
        <p className="connection-success" role="status">
          <CheckCircle2 size={15} />
          {notice}
        </p>
      )}
      {error && (
        <p className="settings-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
