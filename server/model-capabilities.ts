import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { thinkingLevels } from "../shared/settings.ts";
import {
  thinkingModes,
  thinkingTransports,
  serverThinking,
  capabilityLevels,
  type ThinkingCapability,
  type ThinkingOverride,
} from "../shared/model-capabilities.ts";
import type { CustomConnectionInput } from "../shared/custom-connections.ts";

export const thinkingOverrideSchema = z
  .object({
    mode: z.enum(["auto", ...thinkingModes]),
    transport: z.enum(thinkingTransports).optional(),
    levels: z.array(z.enum(thinkingLevels)).min(1).max(7).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.mode === "effort" &&
      (!value.levels?.length ||
        new Set(value.levels).size !== value.levels.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Select the supported effort levels.",
      });
  });

export function catalogModel(
  api: string,
  baseUrl: string,
  modelId: string,
): Model<Api> | undefined {
  const providers: Record<string, string> = {
    "https://api.openai.com/v1": "openai",
    "https://api.anthropic.com/v1": "anthropic",
    "https://generativelanguage.googleapis.com/v1beta": "google",
    "https://openrouter.ai/api/v1": "openrouter",
  };
  const provider = providers[new URL(baseUrl).href.replace(/\/$/, "")];
  if (!provider) return undefined;
  const model = getModel(provider as any, modelId as any) as
    | Model<Api>
    | undefined;
  return model?.api === api ? model : undefined;
}
export function resolveThinking(
  input: CustomConnectionInput,
  metadata?: any,
  props?: any,
): ThinkingCapability {
  const manual = input.thinking;
  if (manual && manual.mode !== "auto") {
    const transport = manual.transport ?? "native";
    if (transport !== "native" && input.api !== "openai-completions")
      throw new Error(
        "This thinking transport requires the OpenAI Chat Completions API format.",
      );
    if (
      ["chat-template", "llama-cpp"].includes(transport) &&
      manual.mode === "effort"
    )
      throw new Error(
        "This thinking transport supports on/off, not distinct effort levels.",
      );
    return {
      mode: manual.mode,
      source: "manual",
      transport,
      ...(manual.mode === "effort" ? { levels: manual.levels } : {}),
    };
  }
  // A protocol-compatible URL or a familiar model name alone is not evidence.
  const model = catalogModel(input.api, input.baseUrl, input.modelId);
  if (model) {
    if (!model.reasoning) return { mode: "unsupported", source: "catalog" };
    return {
      mode: "effort",
      source: "catalog",
      transport: model.provider === "openrouter" ? "openrouter" : "native",
      levels: getSupportedThinkingLevels(model),
      values: Object.fromEntries(
        Object.entries(model.thinkingLevelMap ?? {}).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      ),
    };
  }
  // llama.cpp reports the actual Jinja template, rather than a model-name guess.
  if (
    input.api === "openai-completions" &&
    metadata?.owned_by === "llamacpp" &&
    typeof props?.chat_template === "string" &&
    /\{%[^%]*\b(?:if|elif)\b[^%]*\benable_thinking\b[^%]*%\}/.test(
      props.chat_template,
    )
  )
    return { mode: "toggle", source: "server", transport: "llama-cpp" };
  // Accept an explicit capability declaration, but never infer controls from
  // a generic reasoning:true flag or from a successful text completion.
  const declared = thinkingOverrideSchema.safeParse(
    metadata?.capabilities?.thinking,
  );
  if (declared.success && declared.data.mode !== "auto") {
    const resolved = resolveThinking({
      ...input,
      thinking: declared.data as ThinkingOverride,
    });
    return { ...resolved, source: "server" };
  }
  return serverThinking();
}

export function thinkingModelFields(control: ThinkingCapability) {
  const levels = capabilityLevels(control);
  return {
    reasoning: control.mode === "always" || levels.length > 0,
    thinkingLevelMap: Object.fromEntries(
      thinkingLevels.map((level) => [
        level,
        levels.includes(level) ||
        (control.mode === "always" && level === "medium")
          ? (control.values?.[level] ?? level)
          : null,
      ]),
    ),
  };
}

export async function readThinkingCapabilities(
  path: string,
): Promise<Record<string, ThinkingCapability>> {
  try {
    const source = (await readFile(path, "utf8"))
      .replace(/^\uFEFF/, "")
      .replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*/g, (value) =>
        value.startsWith('"') ? value : "",
      )
      .replace(
        /"(?:\\.|[^"\\])*"|,(\s*[}\]])/g,
        (value, tail) => tail ?? value,
      );
    const config = JSON.parse(source);
    const result: Record<string, ThinkingCapability> = {};
    for (const [id, provider] of Object.entries(config.providers ?? {}) as [
      string,
      any,
    ][]) {
      const control = provider.margin?.thinkingControl;
      const parsed = thinkingOverrideSchema.safeParse(
        control
          ? {
              mode: control.mode,
              transport: control.transport,
              levels: control.levels,
            }
          : undefined,
      );
      if (parsed.success && parsed.data.mode !== "auto")
        result[id] = {
          ...parsed.data,
          source: ["server", "catalog", "manual"].includes(control.source)
            ? control.source
            : "unknown",
          ...(control.values && typeof control.values === "object"
            ? {
                values: Object.fromEntries(
                  Object.entries(control.values).filter(
                    ([key, value]) =>
                      thinkingLevels.includes(key as any) &&
                      typeof value === "string",
                  ),
                ),
              }
            : {}),
        } as ThinkingCapability;
    }
    return result;
  } catch {
    return {};
  }
}
