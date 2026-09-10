import type { ComponentType } from "react";
import type { Anchor, Message, Snapshot, ToolView } from "../shared/types.ts";
export interface BrowserPluginContext {
  snapshot: Snapshot;
  state: unknown;
  action(name: string, input: unknown): Promise<unknown>;
  setComposer(text: string): void;
}
export interface BrowserPlugin {
  id: string;
  apiVersion: 1;
  panels?: {
    id: string;
    title: string;
    component: ComponentType<BrowserPluginContext>;
  }[];
  toolRenderers?: {
    matches: (tool: ToolView) => boolean;
    component: ComponentType<{ tool: ToolView; context: BrowserPluginContext }>;
  }[];
  messageRenderers?: {
    matches: (message: Message) => boolean;
    component: ComponentType<{
      message: Message;
      context: BrowserPluginContext;
    }>;
  }[];
  messageActions?: {
    id: string;
    label: string;
    run: (
      message: Message,
      context: BrowserPluginContext,
      selection?: Anchor,
    ) => void | Promise<void>;
  }[];
}
