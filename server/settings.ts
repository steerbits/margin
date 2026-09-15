import type { Express } from "express";
import { z } from "zod";
import {
  defaultSettings,
  modelKey,
  settingsModel,
  thinkingLevels,
  type MarginSettings,
  type ModelReference,
} from "../shared/settings.ts";
import type { ModelInfo } from "../shared/types.ts";
import type { Store } from "./store.ts";

export const modelReferenceSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  backend: z.string().min(1).optional(),
});
export const settingsSchema = z
  .object({
    defaultModel: modelReferenceSchema.strict().nullable(),
    defaultThinkingLevel: z.enum(thinkingLevels).nullable(),
  })
  .strict();

export function readSettings(store: Store): MarginSettings {
  return (
    store.get<MarginSettings>("preference", "app-settings") ?? {
      ...defaultSettings,
    }
  );
}
export function validateSettings(
  settings: MarginSettings,
  models: ModelInfo[],
) {
  const model = settingsModel(settings, models);
  if (settings.defaultModel && !model)
    throw new Error(
      "The default model is unavailable. Choose another model in Settings.",
    );
  if (
    settings.defaultThinkingLevel &&
    !model?.thinkingLevels?.includes(settings.defaultThinkingLevel)
  )
    throw new Error(
      "The default model does not support that thinking effort. Choose a supported level or Pi default.",
    );
}

// Called only when creating a conversation. Never consult app defaults on resume.
export function newConversationSettings(
  settings: MarginSettings,
  models: ModelInfo[],
  override?: ModelReference,
) {
  if (!override) validateSettings(settings, models);
  const model = override
    ? models.find((m) => modelKey(m) === modelKey(override))
    : settingsModel(settings, models);
  if (!model)
    throw new Error(
      "No available model. Connect a provider account in Settings (or use npm run pi, then /login), then choose a model.",
    );
  return {
    model,
    // An explicit per-chat model may have different capabilities. In that case
    // let Pi choose its normal supported effort rather than changing the default.
    initialThinkingLevel:
      settings.defaultThinkingLevel &&
      model.thinkingLevels?.includes(settings.defaultThinkingLevel)
        ? settings.defaultThinkingLevel
        : undefined,
  };
}

export function installSettingsRoutes(
  app: Express,
  store: Store,
  loadModels: () => Promise<ModelInfo[]>,
) {
  app.get("/api/settings", async (_req, res) => {
    const models = await loadModels();
    res.json({ settings: readSettings(store), models });
  });
  app.put("/api/settings", async (req, res) => {
    const settings = settingsSchema.parse(req.body);
    const models = await loadModels();
    validateSettings(settings, models);
    store.put("preference", "app-settings", settings);
    res.json({ settings, models });
  });
}
