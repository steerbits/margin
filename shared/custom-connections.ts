import type {
  ThinkingCapability,
  ThinkingOverride,
} from "./model-capabilities.ts";
export const customApiFormats = [
  { id: "openai-completions", name: "OpenAI Chat Completions" },
  { id: "openai-responses", name: "OpenAI Responses" },
  { id: "anthropic-messages", name: "Anthropic Messages" },
  { id: "google-generative-ai", name: "Google Generative AI" },
] as const;
export type CustomApi = (typeof customApiFormats)[number]["id"];
export interface CustomConnectionInput {
  id?: string;
  name?: string;
  api: CustomApi;
  baseUrl: string;
  authentication: "api_key" | "none";
  apiKey?: string;
  modelId: string;
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  supportsDeveloperRole?: boolean;
  supportsReasoningEffort?: boolean;
  reasoning?: boolean;
  thinking?: ThinkingOverride;
}
export interface CustomConnectionView {
  id: string;
  name: string;
  api: CustomApi;
  baseUrl: string;
  authentication: "api_key" | "none";
  modelId: string;
  contextWindow: number;
  contextSource: "server" | "manual" | "provisional";
  maxTokens: number;
  maxTokensSource?: "automatic" | "manual";
  hasHeaders: boolean;
  supportsDeveloperRole: boolean;
  supportsReasoningEffort: boolean;
  reasoning: boolean;
  thinking?: ThinkingOverride;
  thinkingControl?: ThinkingCapability;
}
export interface DiscoveredModel {
  id: string;
  name: string;
  contextWindow?: number;
}
export interface ConnectionDiscovery {
  models: DiscoveredModel[];
  message?: string;
}
export const customProviderPrefix = "margin-custom-";
export const noAuthPlaceholder = "margin-local-no-auth";
