import {
  Check,
  FolderOpen,
  LoaderCircle,
  Plug,
  SlidersHorizontal,
} from "lucide-react";
import type { ModelInfo, Project } from "../shared/types.ts";
import { modelProviderLabel } from "../shared/model-picker.ts";
import { WorkspaceList } from "./WorkspacePicker.tsx";
import "./Home.css";

export function Home({
  models,
  projects,
  loaded,
  loadError,
  choosingWorkspace,
  modelError,
  onSettings,
  onOpenWorkspace,
  onSelectWorkspace,
  onCustomize,
}: {
  models: ModelInfo[];
  projects: Project[];
  loaded: boolean;
  loadError?: string;
  choosingWorkspace: boolean;
  modelError?: string;
  onSettings: () => void;
  onOpenWorkspace: () => void;
  onSelectWorkspace: (project: Project) => void;
  onCustomize: () => void;
}) {
  const providers = [
    ...new Map(
      models.map((model) => [model.provider, modelProviderLabel(model)]),
    ).values(),
  ];
  const configured = models.length > 0;
  const loading = !loaded && !loadError;
  return (
    <div className="home-page">
      <div className="home-content">
        <p className="eyebrow">A LITTLE SPACE TO THINK</p>
        <h1>Welcome to Margin</h1>
        <p className="home-intro">
          Connect your AI, open a project, and shape what comes next.
        </p>
        <div className="home-cards">
          <section
            className={`home-card${loaded && !configured ? " home-card-next" : ""}`}
            aria-labelledby="home-ai-heading"
          >
            <div className="home-card-title">
              <Plug size={22} />
              <h2 id="home-ai-heading">AI & settings</h2>
            </div>
            <p>
              Use your subscription, connect an API key, or work with a local
              model.
            </p>
            <div
              className={`home-connection-state${configured ? " configured" : ""}`}
              role="status"
            >
              {loading && (
                <LoaderCircle size={15} className="spin" aria-hidden="true" />
              )}
              {loaded && configured && <Check size={15} aria-hidden="true" />}
              {!loaded
                ? loadError
                  ? "Connections could not be loaded"
                  : "Loading connections…"
                : configured
                  ? `${providers.length} connection${providers.length === 1 ? "" : "s"} configured`
                  : "Connect a provider to get started"}
            </div>
            {configured && (
              <p className="home-provider-names" title={providers.join(" · ")}>
                {providers.slice(0, 3).join(" · ")}
                {providers.length > 3 ? ` · +${providers.length - 3} more` : ""}
              </p>
            )}
            <button
              className={!configured ? "primary" : "home-secondary"}
              onClick={onSettings}
              aria-haspopup="dialog"
              disabled={!loaded}
            >
              {!loaded
                ? loadError
                  ? "Settings unavailable"
                  : "Loading…"
                : configured
                  ? "Open settings"
                  : "Connect an AI provider"}
            </button>
          </section>
          <section
            className={`home-card${loaded && configured ? " home-card-next" : ""}`}
            aria-labelledby="home-workspace-heading"
          >
            <div className="home-card-title">
              <FolderOpen size={22} />
              <h2 id="home-workspace-heading">Your workspace</h2>
            </div>
            <p>
              Choose a project folder. Keep its conversations and notes together
              in one place.
            </p>
            <button
              className={configured ? "primary" : "home-secondary"}
              onClick={onOpenWorkspace}
              disabled={!loaded || choosingWorkspace}
              aria-busy={loading || choosingWorkspace}
              aria-live="polite"
            >
              {loading || choosingWorkspace ? (
                <LoaderCircle size={17} className="spin" aria-hidden="true" />
              ) : (
                <FolderOpen size={17} aria-hidden="true" />
              )}{" "}
              {!loaded
                ? loadError
                  ? "Workspaces unavailable"
                  : "Loading workspaces…"
                : choosingWorkspace
                  ? "Choosing a folder…"
                  : "Open workspace"}
            </button>
          </section>
        </div>
        {modelError && (
          <p role="alert" className="settings-error">
            {modelError}
          </p>
        )}
        {projects.length > 0 && (
          <section
            className="home-recents"
            aria-labelledby="home-recents-heading"
          >
            <h2 id="home-recents-heading">Recent workspaces</h2>
            <WorkspaceList
              projects={projects}
              onSelect={onSelectWorkspace}
              limit={6}
            />
          </section>
        )}
        <a
          className="home-customize"
          href="/customize/examples"
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onCustomize();
          }}
        >
          <SlidersHorizontal size={15} /> Customize Margin
        </a>
      </div>
    </div>
  );
}
