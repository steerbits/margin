import { Plus } from "lucide-react";
import type { Project } from "../shared/types.ts";
import { InstructionsEditor } from "./InstructionsEditor.tsx";
import type { LeaveGuard } from "./leave-guard.ts";

export function WorkspaceHome({
  project,
  guard,
  onNewConversation,
  onGlobal,
}: {
  project: Project;
  guard: LeaveGuard;
  onNewConversation: () => void;
  onGlobal: () => void;
}) {
  return (
    <div className="workspace-home">
      <header className="workspace-home-heading">
        <div>
          <p className="eyebrow">WORKSPACE</p>
          <h1>{project.name}</h1>
          <code>{project.path}</code>
        </div>
        <button className="primary" onClick={onNewConversation}>
          <Plus size={16} /> New conversation
        </button>
      </header>
      <div className="workspace-inheritance">
        <p>Global instructions also apply when configured.</p>
        <a
          href="/customize/instructions"
          onClick={(event) => {
            if (
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return;
            event.preventDefault();
            onGlobal();
          }}
        >
          View global instructions
        </a>
      </div>
      <InstructionsEditor
        key={project.id}
        endpoint={`/projects/${project.id}/instructions`}
        scope="workspace"
        workspaceName={project.name}
        guard={guard}
      />
    </div>
  );
}
