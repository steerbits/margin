export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
export interface ModelInfo {
  id: string;
  provider: string;
  name: string;
  subscription: boolean;
  backend?: string;
}
export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
}
export interface Project {
  id: string;
  name: string;
  path: string;
  launchWritable?: boolean;
  kind?: "margin" | "project";
}
export type ExecutionInfo =
  | { mode: "native" }
  | { mode: "cco-workspaces" }
  | { mode: "cco"; projectRoot: string; writablePaths: string[] };
export interface SessionInfo {
  id: string;
  projectId: string;
  title: string;
  sessionFile?: string;
  model?: ModelInfo;
  backend?: string;
  backendLabel?: string;
  createdAt: number;
  updatedAt: number;
}
export interface Message {
  id: string;
  role: "user" | "assistant" | "tool" | "custom";
  text: string;
  thinking?: string;
  streaming?: boolean;
  error?: string;
  customType?: string;
  details?: unknown;
  skill?: string;
  images?: { data: string; mimeType: string }[];
  tool?: ToolView;
}
export interface ToolView {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  status: "running" | "success" | "error";
  diff?: string;
}
export interface Anchor {
  messageId: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}
export interface Comment {
  id: string;
  anchor: Anchor;
  text: string;
  status: "draft" | "sent" | "resolved";
  batchId?: string;
  createdAt: number;
}
export interface Dialog {
  id: string;
  kind: "select" | "confirm" | "input" | "editor" | "unsupported";
  title: string;
  message?: string;
  options?: string[];
  prefill?: string;
  expiresAt?: number;
}
export interface Notice {
  id: string;
  text: string;
  level: "info" | "warning" | "error";
}
export interface Snapshot {
  session: SessionInfo;
  messages: Message[];
  comments: Comment[];
  composer: string;
  busy: boolean;
  dialogs: Dialog[];
  notices: Notice[];
  statuses: Record<string, string>;
  widgets: Record<string, string[]>;
  skills: SkillInfo[];
  pluginState: Record<string, unknown>;
  thinking?: { level: string; available: string[] };
}
export type SessionEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "activity"; sessionId: string; kind: string; data?: unknown };
export interface FeedbackBatch {
  id: string;
  note: string;
  commentIds: string[];
  skill?: string;
}
