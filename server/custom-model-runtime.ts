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

// Pi 0.85.1 always reserves 4096 tokens, even for a 4096-token server.
// Keep the real context size and adjust the outgoing answer budget instead.
export function installCustomModelSupport(runtime: ModelRuntime) {
  const stream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (model, context, options) => {
    if (!model.provider.startsWith(customProviderPrefix))
      return stream(model, context, options);
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
    return stream(model, context, {
      ...options,
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
        return next;
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
