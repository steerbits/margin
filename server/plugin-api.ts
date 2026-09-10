import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Message, Project } from "../shared/types.ts";
import type { BackendDefinition } from "./backend-api.ts";

export const PLUGIN_API_VERSION = 1;
export interface PluginEvent {
  type: string;
  sessionId: string;
  projectId: string;
  data?: unknown;
}
export interface BackgroundAgent {
  prompt(text: string): Promise<void>;
  subscribe(listener: (event: PluginEvent) => void): () => void;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}
export interface PluginContext {
  project: Project;
  sessionId: string;
  storage: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  publish(state: unknown): void;
  notify(message: string): void;
  getMessages(): Message[];
  createAgent(options: {
    provider: string;
    model: string;
    tools?: string[];
  }): Promise<BackgroundAgent>;
}
export interface ServerPlugin {
  id: string;
  apiVersion: 1;
  backends?: BackendDefinition[];
  tools?: (context: PluginContext) => ToolDefinition[];
  onEvent?: (
    event: PluginEvent,
    context: PluginContext,
  ) => void | Promise<void>;
  action?: (
    name: string,
    input: unknown,
    context: PluginContext,
  ) => unknown | Promise<unknown>;
  dispose?: () => void | Promise<void>;
}
