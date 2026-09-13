import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import type { Project } from "../shared/types.ts";

export function AppDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
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
  const [query, setQuery] = useState("");
  const filtered = projects.filter((project) =>
    `${project.name} ${project.path}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <AppDialog title="All workspaces" onClose={onClose}>
      <label className="workspace-search">
        <Search size={17} />
        <input
          autoFocus
          aria-label="Search workspaces"
          placeholder="Search by name or folder…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="all-workspaces">
        {filtered.map((project) => (
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
    </AppDialog>
  );
}
export function readRecentWorkspaces(): string[] {
  try {
    return JSON.parse(localStorage.getItem("margin.recent-workspaces") ?? "[]");
  } catch {
    return [];
  }
}
