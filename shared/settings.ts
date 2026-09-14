import type { ModelInfo } from "./types.ts";

export const thinkingLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;
export type ThinkingLevel = (typeof thinkingLevels)[number];
export interface ModelReference {
  id: string;
  provider: string;
  backend?: string;
}
export interface MarginSettings {
  defaultModel: ModelReference | null;
  defaultThinkingLevel: ThinkingLevel | null;
}
export interface SettingsView {
  settings: MarginSettings;
  models: ModelInfo[];
}
export const defaultSettings: MarginSettings = {
  defaultModel: null,
  defaultThinkingLevel: null,
};
export const modelKey = (model?: ModelReference | null) =>
  model
    ? JSON.stringify([model.backend ?? "pi", model.provider, model.id])
    : "";
export const thinkingLabel = (level: string) =>
  level === "xhigh"
    ? "Extra high"
    : level.charAt(0).toUpperCase() + level.slice(1);
export const automaticModel = <T extends ModelReference>(
  models: readonly T[],
) => {
  const pi = models.filter((m) => (m.backend ?? "pi") === "pi");
  return (
    pi.find((m) => m.provider === "openai-codex" && m.id === "gpt-5.6-sol") ??
    pi.find((m) => m.provider === "openai-codex") ??
    pi[0]
  );
};
export function settingsModel(settings: MarginSettings, models: ModelInfo[]) {
  return settings.defaultModel
    ? models.find((m) => modelKey(m) === modelKey(settings.defaultModel))
    : automaticModel(models);
}
