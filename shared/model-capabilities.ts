import { thinkingLabel, type ThinkingLevel } from "./settings.ts";

export const thinkingModes = [
  "server",
  "unsupported",
  "toggle",
  "effort",
  "always",
] as const;
export type ThinkingMode = (typeof thinkingModes)[number];
export const thinkingTransports = [
  "native",
  "chat-template",
  "llama-cpp",
  "openrouter",
] as const;
export interface ThinkingCapability {
  mode: ThinkingMode;
  source: "unknown" | "server" | "catalog" | "manual";
  transport?: (typeof thinkingTransports)[number];
  levels?: ThinkingLevel[];
  values?: Partial<Record<ThinkingLevel, string>>;
}
export interface ThinkingOverride {
  mode: "auto" | ThinkingMode;
  transport?: ThinkingCapability["transport"];
  levels?: ThinkingLevel[];
}
export const serverThinking = (): ThinkingCapability => ({
  mode: "server",
  source: "unknown",
});
export function capabilityLevels(control: ThinkingCapability): ThinkingLevel[] {
  if (control.mode === "toggle") return ["off", "medium"];
  if (control.mode === "always") return [];
  if (control.mode === "effort") return control.levels ?? [];
  return [];
}
export function thinkingChoiceLabel(
  level: string,
  control?: ThinkingCapability,
) {
  if (control?.mode === "toggle" && level === "medium") return "On";
  if (control?.mode === "always") return "Always enabled";
  return thinkingLabel(level);
}
export function thinkingDefaultLabel(control?: ThinkingCapability) {
  if (control?.mode === "unsupported") return "Not supported";
  if (control?.mode === "always") return "Always enabled";
  return control ? "Server default" : "Automatic";
}
export function thinkingHelp(control?: ThinkingCapability) {
  if (!control)
    return "Only supported levels are shown. Automatic uses your existing thinking settings.";
  if (control.mode === "unsupported")
    return "Thinking is marked as unsupported for this model.";
  if (control.mode === "always")
    return "Thinking is always enabled for this model.";
  if (control.mode === "server")
    return "Thinking controls were not reported or are managed by the server. Margin sends no override. You can configure capabilities under Advanced.";
  return `Only configured controls are shown (${control.source}). Server default sends no thinking override.`;
}
