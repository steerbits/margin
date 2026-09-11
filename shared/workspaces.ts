export interface WorkspaceFolder {
  name: string;
  path: string;
}
export interface WorkspaceFolders {
  roots: WorkspaceFolder[];
  current: WorkspaceFolder;
  parent: string | null;
  folders: WorkspaceFolder[];
  workspaceParent: string;
}
