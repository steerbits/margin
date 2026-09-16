import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { Project } from "../shared/types.ts";

export function AppDialog({
  title,
  onClose,
  closeOnBackdrop = false,
  children,
}: {
  title: string;
  onClose: () => void;
  closeOnBackdrop?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pointerStartedOutside = useRef(false);
  function isBackdrop(event: {
    target: EventTarget;
    currentTarget: HTMLDialogElement;
    clientX: number;
    clientY: number;
  }) {
    if (event.target !== event.currentTarget) return false;
    // Native dialogs receive backdrop events too; padding is still inside.
    const rect = event.currentTarget.getBoundingClientRect();
    return (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    );
  }
  useLayoutEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="management-dialog"
      aria-label={title}
      onPointerDown={(event) => {
        pointerStartedOutside.current = isBackdrop(event);
      }}
      onClick={(event) => {
        const dismiss =
          closeOnBackdrop && pointerStartedOutside.current && isBackdrop(event);
        pointerStartedOutside.current = false;
        if (dismiss) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="management-heading">
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function WorkspacePicker({
  projects,
  current,
  onSelect,
  onClose,
}: {
  projects: Project[];
  current: string;
  onSelect: (project: Project) => void;
  onClose: () => void;
}) {
  return (
    <AppDialog title="All workspaces" onClose={onClose}>
      <WorkspaceList
        projects={projects}
        current={current}
        onSelect={onSelect}
        autoFocus
      />
    </AppDialog>
  );
}
export function WorkspaceList({
  projects,
  current,
  onSelect,
  autoFocus = false,
  limit,
}: {
  projects: Project[];
  current?: string;
  onSelect: (project: Project) => void;
  autoFocus?: boolean;
  limit?: number;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filtered = projects.filter((project) =>
    `${project.name} ${project.path}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <label className="workspace-search">
        <Search size={17} />
        <input
          autoFocus={autoFocus}
          aria-label="Search workspaces"
          placeholder="Search by name or folder…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="all-workspaces">
        {(limit && !query && !expanded
          ? filtered.slice(0, limit)
          : filtered
        ).map((project) => (
          <button
            key={project.id}
            data-project-id={project.id}
            aria-current={project.id === current ? "true" : undefined}
            onClick={() => onSelect(project)}
          >
            <strong>{project.name}</strong>
            <span>{project.path}</span>
          </button>
        ))}
      </div>
      {!filtered.length && <p>No workspaces match your search.</p>}
      {limit && !query && !expanded && filtered.length > limit && (
        <button className="text-link" onClick={() => setExpanded(true)}>
          Show all workspaces
        </button>
      )}
    </>
  );
}
export function readRecentWorkspaces(): string[] {
  try {
    return JSON.parse(localStorage.getItem("margin.recent-workspaces") ?? "[]");
  } catch {
    return [];
  }
}
