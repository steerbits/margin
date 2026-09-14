import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  defaultSettings,
  modelKey,
  settingsModel,
  thinkingLabel,
  type MarginSettings,
  type SettingsView,
  type ThinkingLevel,
} from "../shared/settings.ts";
import type { ModelInfo } from "../shared/types.ts";
import { api } from "./api.ts";
import { AppDialog } from "./WorkspacePicker.tsx";
import "./SettingsDialog.css";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<MarginSettings>({ ...defaultSettings });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    void api<SettingsView>("/settings")
      .then((view) => {
        if (!active) return;
        setDraft(view.settings);
        setModels(view.models);
        setLoaded(true);
      })
      .catch((e) => {
        if (active) setError(String(e.message ?? e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const model = settingsModel(draft, models);
  const levels = model?.thinkingLevels ?? [];
  const invalidModel = !!draft.defaultModel && !model;
  const invalidThinking =
    !!draft.defaultThinkingLevel &&
    !levels.includes(draft.defaultThinkingLevel);
  const pending = loading || saving;
  const runtimeDefault =
    (model?.backend ?? "pi") === "pi" ? "Pi default" : "Runtime default";
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const view = await api<SettingsView>("/settings");
      setModels(view.models);
      if (!loaded) setDraft(view.settings);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AppDialog
      title="Settings"
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!loaded || pending || invalidModel || invalidThinking) return;
          setSaving(true);
          setError("");
          void api<SettingsView>("/settings", draft, "PUT")
            .then(onClose)
            .catch((e) => setError(String(e.message ?? e)))
            .finally(() => setSaving(false));
        }}
      >
        <section aria-labelledby="conversation-defaults-heading">
          <div className="settings-section-heading">
            <h3 id="conversation-defaults-heading">
              New conversation defaults
            </h3>
            <button
              type="button"
              aria-label="Refresh available models"
              title="Refresh available models"
              disabled={pending}
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} className={loading ? "spin" : undefined} />
            </button>
          </div>
          <p className="settings-description" id="settings-scope">
            Applies across workspaces to new conversations only. Existing
            conversations keep their settings.
          </p>
          <div className="settings-fields" aria-busy={loading}>
            <label>
              Default model
              <select
                aria-label="Default model"
                aria-describedby="settings-model-help"
                disabled={!loaded || pending}
                value={modelKey(draft.defaultModel)}
                onChange={(event) => {
                  const selected = models.find(
                    (m) => modelKey(m) === event.target.value,
                  );
                  const next: MarginSettings = {
                    ...draft,
                    defaultModel: selected
                      ? {
                          id: selected.id,
                          provider: selected.provider,
                          backend: selected.backend,
                        }
                      : null,
                  };
                  const nextModel = settingsModel(next, models);
                  if (
                    next.defaultThinkingLevel &&
                    !nextModel?.thinkingLevels?.includes(
                      next.defaultThinkingLevel,
                    )
                  ) {
                    setNotice(
                      `Thinking effort reset to the runtime default because this model does not support ${thinkingLabel(next.defaultThinkingLevel)}.`,
                    );
                    next.defaultThinkingLevel = null;
                  } else setNotice("");
                  setDraft(next);
                  setError("");
                }}
              >
                <option value="">
                  Automatic · prefer ChatGPT subscription
                </option>
                {invalidModel && (
                  <option value={modelKey(draft.defaultModel)}>
                    Unavailable · {draft.defaultModel!.provider} /{" "}
                    {draft.defaultModel!.id}
                  </option>
                )}
                {models.map((m) => (
                  <option key={modelKey(m)} value={modelKey(m)}>
                    {m.name} · {m.provider}
                    {m.subscription
                      ? m.provider === "anthropic"
                        ? " · extra usage"
                        : " · subscription"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            <p id="settings-model-help" className="settings-help">
              {invalidModel
                ? "The saved model is unavailable. Choose another model or refresh after signing in through pi /login."
                : !models.length && loaded
                  ? "No authenticated models found. Sign in through pi /login, then refresh."
                  : !draft.defaultModel && model
                    ? `Currently: ${model.name} · ${model.provider}.`
                    : "Provider accounts are separate; Margin will not silently switch providers if a selected model becomes unavailable."}
            </p>
            <label>
              Thinking effort
              <select
                aria-label="Thinking effort"
                disabled={
                  !loaded || pending || (!levels.length && !invalidThinking)
                }
                value={draft.defaultThinkingLevel ?? ""}
                aria-describedby="settings-thinking-help"
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    defaultThinkingLevel: (event.target.value ||
                      null) as ThinkingLevel | null,
                  });
                  setNotice("");
                  setError("");
                }}
              >
                <option value="">{runtimeDefault}</option>
                {invalidThinking && (
                  <option value={draft.defaultThinkingLevel!}>
                    Unavailable · {thinkingLabel(draft.defaultThinkingLevel!)}
                  </option>
                )}
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {thinkingLabel(level)}
                  </option>
                ))}
              </select>
            </label>
            <p id="settings-thinking-help" className="settings-help">
              {invalidThinking
                ? "The saved effort is unsupported. Choose a supported level or change the model."
                : levels.length === 1 && levels[0] === "off"
                  ? "This model does not support thinking."
                  : !levels.length && model
                    ? "This runtime does not expose thinking effort."
                    : "Only supported levels are shown. Pi default uses your existing Pi configuration."}
            </p>
          </div>
        </section>
        {loading && <p role="status">Loading settings…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && (
          <p className="settings-error" role="alert">
            {error}
          </p>
        )}
        <p className="settings-footnote">
          Saved in Margin, not in your global Pi settings.
        </p>
        <div className="management-actions">
          <button type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={!loaded || pending || invalidModel || invalidThinking}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
