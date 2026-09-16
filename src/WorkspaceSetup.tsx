import { FolderOpen } from "lucide-react";

export function WorkspaceSetup({
  onOpen,
  disabled = false,
}: {
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <section className="workspace-setup" aria-label="Choose a workspace">
      <div className="workspace-setup-heading">
        <FolderOpen size={20} aria-hidden="true" />
        <strong>Choose where to work</strong>
      </div>
      <p>
        You’re in Margin’s own workspace. Open a project folder to work on your
        files.
      </p>
      <button
        className="primary"
        type="button"
        disabled={disabled}
        onClick={onOpen}
      >
        <FolderOpen size={16} aria-hidden="true" /> Open workspace
      </button>
    </section>
  );
}
