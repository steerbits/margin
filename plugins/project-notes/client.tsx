import { useEffect, useRef, useSyncExternalStore } from "react";
import type {
  BrowserPlugin,
  WorkspacePluginContext,
} from "../../src/plugin-api.ts";
import { isDirty, ProjectDrafts } from "./drafts.ts";
import { MAX_NOTE_LENGTH } from "./model.ts";
import "./styles.css";

const drafts = new ProjectDrafts();
const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
  if (drafts.hasUnsaved()) {
    event.preventDefault();
    event.returnValue = "";
  }
};
// This must outlive the mounted panel, including when a different project is open.
window.addEventListener("beforeunload", warnBeforeLeaving);
import.meta.hot?.dispose(() =>
  window.removeEventListener("beforeunload", warnBeforeLeaving),
);

function Editor({ project, sessionId, action }: WorkspacePluginContext) {
  const draft = drafts.get(project.id);
  const state = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const actionRef = useRef(action);
  actionRef.current = action;
  useEffect(() => {
    const refresh = () => void draft.refresh(actionRef.current);
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [draft, sessionId]);

  const dirty = isDirty(state);
  const pending = state.loading || state.saving;
  const canSave = !!state.base && dirty && !pending && !state.conflict;
  const status = state.saving
    ? "Saving…"
    : state.loading
      ? "Loading notes…"
      : state.conflict
        ? "Conflict — draft kept"
        : dirty
          ? "Unsaved changes"
          : !state.base
            ? "Notes unavailable"
            : state.base.revision
              ? "Saved"
              : "No saved note yet";

  return (
    <section className="project-notes" aria-label="Project notepad">
      <p className="project-notes-hint">
        Notes for <strong>{project.name}</strong> · Shared by every chat in this
        workspace. Only Save writes to storage.
      </p>
      <label htmlFor="project-notes-text">Project notes</label>
      <textarea
        id="project-notes-text"
        value={state.text}
        disabled={!state.base}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="Decisions, reminders, next steps…"
        aria-describedby="project-notes-status"
        onChange={(event) => draft.edit(event.target.value)}
        onKeyDown={(event) => {
          if (
            (event.metaKey || event.ctrlKey) &&
            event.key === "Enter" &&
            canSave
          ) {
            event.preventDefault();
            void draft.save(actionRef.current);
          }
        }}
      />
      <div className="project-notes-actions">
        <button
          className="primary"
          disabled={!canSave}
          onClick={() => void draft.save(actionRef.current)}
        >
          Save notes
        </button>
        <button
          disabled={pending}
          onClick={() => void draft.refresh(actionRef.current)}
        >
          Refresh notes
        </button>
      </div>
      <p id="project-notes-status" role="status">
        {status}
      </p>
      {state.error && (
        <p role="alert">
          {state.error} Your draft has not been discarded. Try again.
        </p>
      )}
      {state.conflict && (
        <div className="project-notes-conflict">
          <p role="alert">
            The saved note changed elsewhere. Your draft is still in the editor
            above.
          </p>
          <label htmlFor="project-notes-saved">Latest saved note</label>
          <textarea
            id="project-notes-saved"
            value={state.conflict.text}
            readOnly
          />
          <p>
            Review or merge the text above. Keeping your draft does not save it;
            the next Save replaces the version shown here.
          </p>
          <div className="project-notes-actions">
            <button
              disabled={pending}
              onClick={() => draft.resolveConflict(true)}
            >
              Keep my draft
            </button>
            <button
              disabled={pending}
              onClick={() => {
                if (
                  window.confirm(
                    "Discard your unsaved draft and use the latest saved note?",
                  )
                )
                  draft.resolveConflict(false);
              }}
            >
              Use saved note
            </button>
          </div>
        </div>
      )}
      <p className="project-notes-hint">
        Unsaved edits stay in this tab when you close Notes or switch
        conversations. Save before reloading. Limit: 100,000 characters.
      </p>
    </section>
  );
}

function Panel(context: WorkspacePluginContext) {
  return <Editor key={context.project.id} {...context} />;
}
const plugin: BrowserPlugin = {
  id: "project-notes",
  apiVersion: 1,
  panels: [
    { id: "notes", title: "Notes", scope: "workspace", component: Panel },
  ],
};
export default plugin;
