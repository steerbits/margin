export interface Checkpoint {
  id: string;
  name: string;
  createdAt: number;
  commit: string;
  tree: string;
  kind: "manual" | "automatic" | "before-restore";
  restoredFrom?: string;
}
export interface CheckpointPreview {
  checkpoint: Checkpoint;
  token: string;
  files: { path: string; change: "added" | "modified" | "deleted" }[];
  diff: string;
}
export interface HistoryState {
  available: boolean;
  error?: string;
  checkpoints: Checkpoint[];
  currentId?: string;
  returnToId?: string;
  activationPending: boolean;
  pendingRestoreTarget?: string;
  recoveryCommand: string;
}
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  directory: string;
  browser: boolean;
  server: boolean;
  enabled: boolean;
  active: boolean;
  error?: string;
}
export const customizationExamples = [
  {
    id: "tasks",
    title: "Turn ideas into tasks",
    description: "A project task board with a button beneath replies.",
    prompt:
      "Build a project task-board plugin with a side panel and a Turn into task action beneath assistant replies. Persist tasks per project. Let me explicitly choose when work starts.",
  },
  {
    id: "notes-tools",
    title: "Let your assistant work with notes",
    description:
      "Give the agent tools to read and update your project notepad.",
    prompt:
      "Extend the project-notes plugin with tools that let the assistant read and update the current project's notes. Preserve its revision checks and show changes in the panel.",
  },
  {
    id: "decisions",
    title: "Remember decisions",
    description: "Save decisions and quoted passages as you review.",
    prompt:
      "Build a decision-log plugin. Add an action beneath replies to save a decision with its original quotation, and a project panel to edit and review saved decisions.",
  },
  {
    id: "supervisor",
    title: "Add a supervisor",
    description: "A separate agent summarizes work in a side panel.",
    prompt:
      "Build a supervisor plugin using the background-agent API. Let me start and stop it explicitly, show which model it uses, and summarize the main agent's visible activity after completed turns. Avoid a model request for every streamed token.",
  },
  {
    id: "results",
    title: "Make results visual",
    description: "Render structured tool output as tables or charts.",
    prompt:
      "Build a browser renderer plugin for a useful structured tool result. Show a readable table or chart while preserving the normal raw-result fallback and renderer error boundary.",
  },
];
