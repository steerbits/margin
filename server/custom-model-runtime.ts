import type {
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  customProviderPrefix,
  noAuthPlaceholder,
} from "../shared/custom-connections.ts";
import {
  capabilityLevels,
  serverThinking,
  type ThinkingCapability,
} from "../shared/model-capabilities.ts";
import type { ThinkingLevel } from "../shared/settings.ts";
import {
  readThinkingCapabilities,
  catalogModel,
} from "./model-capabilities.ts";

const runtimeState = new WeakMap<
  ModelRuntime,
  {
    controls: Record<string, ThinkingCapability>;
    path?: string;
    selection?: ThinkingLevel | null;
  }
>();
export function customThinkingControl(
  runtime: ModelRuntime,
  model: Model<Api>,
) {
  return model.provider.startsWith(customProviderPrefix)
    ? (runtimeState.get(runtime)?.controls[model.provider] ?? serverThinking())
    : undefined;
}
export function setCustomThinkingSelection(
  runtime: ModelRuntime,
  level: ThinkingLevel | null,
) {
  const state = runtimeState.get(runtime);
  if (state) state.selection = level;
}
export function getCustomThinkingSelection(runtime: ModelRuntime) {
  return runtimeState.get(runtime)?.selection ?? null;
}
export async function refreshRuntimeCapabilities(runtime: ModelRuntime) {
  const state = runtimeState.get(runtime);
  if (state?.path) state.controls = await readThinkingCapabilities(state.path);
}
export async function loadCustomModelSupport(
  runtime: ModelRuntime,
  path: string,
) {
  return installCustomModelSupport(
    runtime,
    await readThinkingCapabilities(path),
    path,
  );
}
export function applyThinkingPayload(
  payload: Record<string, any>,
  api: string,
  control: ThinkingCapability,
  choice: ThinkingLevel | null | undefined,
  budget: number,
) {
  delete payload.reasoning_effort;
  delete payload.enable_thinking;
  delete payload.reasoning;
  delete payload.thinking;
  delete payload.thinking_token_budget;
  delete payload.thinking_budget;
  delete payload.thinking_budget_tokens;
  if (payload.chat_template_kwargs) {
    delete payload.chat_template_kwargs.enable_thinking;
    if (!Object.keys(payload.chat_template_kwargs).length)
      delete payload.chat_template_kwargs;
  }
  if (payload.output_config) delete payload.output_config.effort;
  if (payload.config) delete payload.config.thinkingConfig;
  if (!choice || control.mode === "server" || control.mode === "unsupported")
    return payload;
  const enabled = choice !== "off";
  const effort = control.values?.[choice] ?? choice;
  if (["chat-template", "llama-cpp"].includes(control.transport ?? "")) {
    payload.chat_template_kwargs = {
      ...payload.chat_template_kwargs,
      enable_thinking: enabled,
    };
    if (control.transport === "llama-cpp")
      payload.reasoning_format = "deepseek";
  } else if (control.transport === "openrouter") {
    payload.reasoning =
      control.mode === "effort" && enabled ? { effort } : { enabled };
  } else if (api === "openai-completions")
    payload.reasoning_effort = enabled ? effort : "none";
  else if (api === "openai-responses")
    payload.reasoning = { effort: enabled ? effort : "none" };
  else if (api === "anthropic-messages") {
    if (!enabled) payload.thinking = { type: "disabled" };
    else if (control.mode === "effort") {
      payload.thinking = { type: "adaptive" };
      payload.output_config = { ...payload.output_config, effort };
    } else {
      if (budget < 1280)
        throw new Error(
          "This API needs at least 1280 reply tokens to enable thinking. Increase Maximum reply tokens in Advanced, or use Server default.",
        );
      payload.thinking = { type: "enabled", budget_tokens: 1024 };
    }
  } else if (api === "google-generative-ai") {
    payload.config ??= {};
    payload.config.thinkingConfig =
      control.mode === "effort" && enabled
        ? { thinkingLevel: effort.toUpperCase() }
        : { thinkingBudget: enabled ? -1 : 0 };
  }
  return payload;
}

// Pi 0.85.1 always reserves 4096 tokens, even for a 4096-token server.
// Keep the real context size and adjust the outgoing answer budget instead.
export function installCustomModelSupport(
  runtime: ModelRuntime,
  controls: Record<string, ThinkingCapability> = {},
  path?: string,
) {
  runtimeState.set(runtime, { controls, path });
  const stream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (model, context, options) => {
    if (!model.provider.startsWith(customProviderPrefix))
      return stream(model, context, options);
    const state = runtimeState.get(runtime)!;
    const control = customThinkingControl(runtime, model)!;
    const choice =
      state.selection !== undefined ? state.selection : options?.reasoning;
    const catalog =
      control.source === "catalog"
        ? catalogModel(model.api, model.baseUrl, model.id)
        : undefined;
    if (choice && !capabilityLevels(control).includes(choice))
      throw new Error(
        "This model no longer supports that thinking choice. Select Server default or an available choice.",
      );
    const reserve = Math.min(
      4096,
      Math.max(128, Math.floor(model.contextWindow / 10)),
    );
    const remaining =
      model.contextWindow - estimateContextTokens(context).tokens - reserve;
    const budget = Math.floor(
      Math.min(options?.maxTokens ?? model.maxTokens, remaining),
    );
    if (budget < 32)
      throw new Error(
        "This server's context is too small for this conversation. Start a new conversation or increase the server's context.",
      );
    const fetcher = options?.fetch ?? globalThis.fetch;
    const requestModel = catalog
      ? {
          ...model,
          compat: { ...model.compat, ...catalog.compat },
          thinkingLevelMap: catalog.thinkingLevelMap,
        }
      : model;
    return stream(requestModel, context, {
      ...options,
      reasoning: catalog && choice && choice !== "off" ? choice : undefined,
      fetch:
        model.api === "google-generative-ai"
          ? undefined
          : async (input, init) => {
              const headers = new Headers(
                init?.headers ??
                  (input instanceof Request ? input.headers : undefined),
              );
              for (const name of [
                "authorization",
                "x-api-key",
                "x-goog-api-key",
              ])
                if (
                  [noAuthPlaceholder, `Bearer ${noAuthPlaceholder}`].includes(
                    headers.get(name) ?? "",
                  )
                )
                  headers.delete(name);
              return fetcher(input, { ...init, headers, redirect: "error" });
            },
      onPayload: async (payload, currentModel) => {
        const supplied = await options?.onPayload?.(payload, currentModel);
        const next = (supplied ?? payload) as Record<string, any>;
        if ("max_completion_tokens" in next)
          next.max_completion_tokens = budget;
        if ("max_tokens" in next) next.max_tokens = budget;
        if ("max_output_tokens" in next) next.max_output_tokens = budget;
        if (next.config && "maxOutputTokens" in next.config)
          next.config.maxOutputTokens = budget;
        if (catalog && choice) {
          if (
            next.thinking?.type === "enabled" &&
            next.thinking.budget_tokens >= budget
          ) {
            if (budget < 1280)
              throw new Error(
                "Not enough reply tokens for thinking. Increase Maximum reply tokens or use Server default.",
              );
            next.thinking.budget_tokens = Math.min(
              next.thinking.budget_tokens,
              budget - 256,
            );
          }
          return next;
        }
        return applyThinkingPayload(next, model.api, control, choice, budget);
      },
    });
  };
  return runtime;
}

// Adapt this session's thresholds without rewriting global Pi settings.
export function configureCustomCompaction(
  settings: SettingsManager,
  model: () => Model<Api> | undefined,
) {
  const original = settings.getCompactionSettings.bind(settings);
  const branch = settings.getBranchSummarySettings.bind(settings);
  settings.getCompactionSettings = () => {
    const values = original();
    const current = model();
    if (!current?.provider.startsWith(customProviderPrefix)) return values;
    return {
      ...values,
      reserveTokens: Math.min(
        values.reserveTokens,
        Math.max(256, Math.floor(current.contextWindow / 4)),
      ),
      keepRecentTokens: Math.min(
        values.keepRecentTokens,
        Math.max(256, Math.floor(current.contextWindow / 3)),
      ),
    };
  };
  settings.getBranchSummarySettings = () => {
    const values = branch();
    const current = model();
    if (!current?.provider.startsWith(customProviderPrefix)) return values;
    return {
      ...values,
      reserveTokens: Math.min(
        values.reserveTokens,
        Math.max(256, Math.floor(current.contextWindow / 4)),
      ),
    };
  };
}

export async function refreshCustomSessionModel(
  runtime: ModelRuntime,
  current: Model<Api>,
  signal?: AbortSignal,
) {
  if (!current.provider.startsWith(customProviderPrefix)) return current;
  await runtime.refresh({ allowNetwork: false, signal });
  await refreshRuntimeCapabilities(runtime);
  signal?.throwIfAborted();
  const model = (await runtime.getAvailable(current.provider, { signal })).find(
    (candidate) => candidate.id === current.id,
  );
  if (!model)
    throw new Error(
      "This custom connection was removed or is unavailable. Choose another model in Settings.",
    );
  return model;
}
