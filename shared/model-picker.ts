import type { ModelConnectionSource, ModelInfo } from "./types.ts";

export const modelGroups: { id: ModelConnectionSource; label: string }[] = [
  { id: "saved", label: "Saved Connections" },
  { id: "key", label: "Keys" },
  { id: "custom", label: "Custom" },
];
export const configureModelLabel = "Configure a model in Settings";
const providerNames: Record<string, string> = {
  anthropic: "Anthropic",
  "openai-codex": "ChatGPT / Codex",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  "github-copilot": "GitHub Copilot",
  google: "Google",
  xai: "xAI",
  deepseek: "DeepSeek",
  groq: "Groq",
  "llama-cpp": "llama.cpp",
};
export function modelProviderLabel(
  model: Pick<ModelInfo, "provider" | "providerName">,
) {
  return Object.hasOwn(providerNames, model.provider)
    ? providerNames[model.provider]
    : model.providerName || model.provider;
}
export function modelLabel(
  model: Pick<ModelInfo, "provider" | "providerName" | "name" | "backend">,
) {
  const runtime =
    model.backend && model.backend !== "pi" ? ` (${model.backend})` : "";
  // Keep routed model names (e.g. "Anthropic: Claude …") intact; the first
  // segment always identifies the connection/billing provider, not the author.
  return `${modelProviderLabel(model)} • ${model.name}${runtime}`;
}
export function modelBillingSuffix(model: ModelInfo) {
  return model.subscription
    ? model.provider === "anthropic"
      ? " (extra usage)"
      : " (subscription)"
    : "";
}
const compare = new Intl.Collator("en", { numeric: true, sensitivity: "base" })
  .compare;
export function groupedModels(models: readonly ModelInfo[]) {
  return modelGroups
    .map((group) => ({
      ...group,
      // Older plugin metadata does not describe Pi credentials; keep it under
      // Custom rather than pretending it has a saved login or an environment key.
      models: models
        .filter((model) => (model.connectionSource ?? "custom") === group.id)
        .sort(
          (a, b) =>
            compare(modelProviderLabel(a), modelProviderLabel(b)) ||
            compare(a.provider, b.provider) ||
            compare(a.name, b.name) ||
            compare(a.id, b.id) ||
            compare(a.backend ?? "pi", b.backend ?? "pi"),
        ),
    }))
    .filter((group) => group.models.length > 0);
}
