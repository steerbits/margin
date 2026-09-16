import { useEffect, useRef, useState } from "react";
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
import { ProviderAccountsPanel } from "./ProviderAccounts.tsx";
import { WorkspaceSetup } from "./WorkspaceSetup.tsx";
import { ModelOptions } from "./ModelOptions.tsx";
import { modelLabel, modelProviderLabel } from "../shared/model-picker.ts";
import { SettingsAutosave } from "./settings-autosave.ts";
import {
  thinkingChoiceLabel,
  thinkingDefaultLabel,
  thinkingHelp,
} from "../shared/model-capabilities.ts";
import "./SettingsDialog.css";

export function SettingsDialog({
  onClose,
  onModelsChanged,
  onOpenWorkspace,
}: {
  onClose: () => void;
  onModelsChanged?: (models: ModelInfo[]) => void;
  onOpenWorkspace?: () => void;
}) {
  const [draft, setDraft] = useState<MarginSettings>({ ...defaultSettings });
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const autosave = useRef<SettingsAutosave | undefined>(undefined);
  const mounted = useRef(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(true);
  const accountsRef = useRef<HTMLDetailsElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const revealWorkspace = useRef(false);
  const modelsChanged = useRef(onModelsChanged);
  modelsChanged.current = onModelsChanged;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function initializeAutosave(value: MarginSettings) {
    if (autosave.current) return;
    setDraft(value);
    autosave.current = new SettingsAutosave(
      value,
      async (next) => {
        await api<SettingsView>("/settings", next, "PUT");
      },
      () => {
        if (!mounted.current || !autosave.current) return;
        setDraft({ ...autosave.current.draft });
        setSaving(autosave.current.saving);
        setSaveError(autosave.current.error);
      },
    );
  }
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void api<SettingsView>("/settings")
      .then((view) => {
        if (!active) return;
        initializeAutosave(view.settings);
        setModels(view.models);
        modelsChanged.current?.(view.models);
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
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!revealWorkspace.current) return;
    workspaceRef.current?.closest("dialog")?.scrollTo({ top: 0 });
    revealWorkspace.current = false;
  }, [models]);
  const model = settingsModel(draft, models);
  const levels = model?.thinkingLevels ?? [];
  const invalidModel = !!draft.defaultModel && !model;
  const invalidThinking =
    !!draft.defaultThinkingLevel &&
    !levels.includes(draft.defaultThinkingLevel);
  const pending = loading || accountBusy;
  const runtimeDefault = thinkingDefaultLabel(model?.thinkingControl);
  function change(next: MarginSettings) {
    autosave.current?.update(next);
    setError("");
  }
  async function close() {
    if (!autosave.current || (await autosave.current.flush())) onClose();
  }
  async function openWorkspace() {
    if (autosave.current && !(await autosave.current.flush())) return;
    onClose();
    onOpenWorkspace?.();
  }
  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const view = await api<SettingsView>("/settings");
      revealWorkspace.current = models.length === 0 && view.models.length > 0;
      setModels(view.models);
      modelsChanged.current?.(view.models);
      initializeAutosave(view.settings);
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  return (
    <AppDialog title="Settings" closeOnBackdrop onClose={() => void close()}>
      {onOpenWorkspace && models.length > 0 && (
        <div ref={workspaceRef}>
          <WorkspaceSetup
            onOpen={() => void openWorkspace()}
            disabled={accountBusy || loading}
          />
        </div>
      )}
      <details
        ref={accountsRef}
        className="settings-accounts"
        open={accountsOpen}
        onToggle={(event) => setAccountsOpen(event.currentTarget.open)}
      >
        <summary>
          AI connections{" "}
          <span>
            {accountBusy
              ? "Connection in progress"
              : "Accounts, API keys, and custom servers"}
          </span>
        </summary>
        <ProviderAccountsPanel
          onChanged={refresh}
          onBusyChange={setAccountBusy}
        />
      </details>
      <form
        className="settings-form"
        onSubmit={(event) => event.preventDefault()}
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
                    ...(autosave.current?.draft ?? draft),
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
                  change(next);
                }}
              >
                <option value="">
                  {models.length
                    ? "Automatic · prefer ChatGPT subscription"
                    : "Connect a provider first"}
                </option>
                {invalidModel && (
                  <option value={modelKey(draft.defaultModel)} disabled>
                    {modelProviderLabel(draft.defaultModel!)} •{" "}
                    {draft.defaultModel!.id} (unavailable)
                  </option>
                )}
                <ModelOptions models={models} billing />
              </select>
            </label>
            <p id="settings-model-help" className="settings-help">
              {invalidModel
                ? "The saved model is unavailable. Connect its provider account above and refresh, or choose another model."
                : !models.length && loaded
                  ? "No authenticated models found. Connect a provider account above, then choose a model."
                  : !draft.defaultModel && model
                    ? `Currently: ${modelLabel(model)}.`
                    : "Provider accounts are separate; Margin will not silently switch providers if a selected model becomes unavailable."}
            </p>
            {!models.length && loaded && (
              <button
                type="button"
                className="text-link connect-provider-link"
                onClick={() => {
                  setAccountsOpen(true);
                  requestAnimationFrame(() =>
                    accountsRef.current?.scrollIntoView({ block: "start" }),
                  );
                }}
              >
                Connect a provider
              </button>
            )}
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
                  change({
                    ...(autosave.current?.draft ?? draft),
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
                    {thinkingChoiceLabel(level, model?.thinkingControl)}
                  </option>
                ))}
              </select>
            </label>
            <p id="settings-thinking-help" className="settings-help">
              {invalidThinking
                ? "The saved effort is unsupported. Choose a supported level or change the model."
                : model?.thinkingControl
                  ? thinkingHelp(model.thinkingControl)
                  : levels.length === 1 && levels[0] === "off"
                    ? "This model does not support thinking."
                    : !levels.length && model
                      ? "This runtime does not expose thinking effort."
                      : "Only supported levels are shown. Automatic uses the model's default thinking effort."}
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
          Defaults save automatically when changed and apply to new
          conversations.
        </p>
        {loaded && (
          <p className="settings-save-state" role="status">
            {saving
              ? "Saving…"
              : saveError
                ? "Changes are not saved."
                : "Saved"}
          </p>
        )}
        {saveError && (
          <div className="settings-error" role="alert">
            <p>Couldn't save: {saveError}</p>
            <button type="button" onClick={() => autosave.current?.retry()}>
              Retry saving
            </button>
            <button type="button" onClick={onClose}>
              Close without retrying
            </button>
          </div>
        )}
        <div className="management-actions">
          <button
            className="primary"
            type="button"
            onClick={() => void close()}
          >
            Close
          </button>
        </div>
      </form>
    </AppDialog>
  );
}
