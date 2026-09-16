import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  type Api,
  type Model,
  type Credential,
  type CredentialStore,
} from "@earendil-works/pi-ai";
import type { ModelConnectionSource, ModelInfo } from "../shared/types.ts";
import {
  loadCustomModelSupport,
  customThinkingControl,
} from "./custom-model-runtime.ts";
import { capabilityLevels } from "../shared/model-capabilities.ts";

// Optional mode for hosts that allow reading Pi credentials but cannot acquire its write lock.
// No credential copies are persisted. Expired credentials must be refreshed by Pi externally.
export function readOnlyCredentials(authPath: string): CredentialStore {
  const readAll = async (): Promise<Record<string, Credential>> =>
    JSON.parse(await readFile(authPath, "utf8"));
  return {
    read: async (providerId) => structuredClone((await readAll())[providerId]),
    list: async () =>
      Object.entries(await readAll()).map(([providerId, c]) => ({
        providerId,
        type: c.type,
      })),
    modify: async () => {
      throw new Error(
        "Read-only login mode cannot refresh credentials. Restart Margin without MARGIN_AUTH_READ_ONLY and reconnect the provider in Settings.",
      );
    },
    delete: async () => {
      throw new Error("Read-only login mode cannot modify credentials.");
    },
  };
}
export async function createModels(dataDir: string, signal?: AbortSignal) {
  return loadCustomModelSupport(
    await ModelRuntime.create({
      signal,
      modelsStorePath: join(dataDir, "models-store.json"),
      ...(process.env.MARGIN_AUTH_READ_ONLY === "1"
        ? { credentials: readOnlyCredentials(join(getAgentDir(), "auth.json")) }
        : {}),
    }),
    join(getAgentDir(), "models.json"),
  );
}
export function modelConnectionSource(
  runtime: Pick<ModelRuntime, "getProviderAuthStatus">,
  provider: string,
): ModelConnectionSource {
  // Use Pi's resolved source, not a vendor allowlist or secret credential data.
  const { source } = runtime.getProviderAuthStatus(provider);
  if (source === "stored") return "saved";
  if (source === "environment" || source === "runtime") return "key";
  return "custom";
}
export function modelInfo(runtime: ModelRuntime, model: Model<Api>): ModelInfo {
  const control = customThinkingControl(runtime, model);
  return {
    ...modelFields(model),
    backend: "pi",
    providerName: runtime.getProvider(model.provider)?.name,
    connectionSource: modelConnectionSource(runtime, model.provider),
    subscription: runtime.isUsingSubscription(model.provider),
    thinkingLevels: control
      ? capabilityLevels(control)
      : getSupportedThinkingLevels(model),
    ...(control ? { thinkingControl: control } : {}),
  };
}
function modelFields(m: { id: string; provider: string; name: string }) {
  return { id: m.id, provider: m.provider, name: m.name };
}
export async function listModels(runtime: ModelRuntime): Promise<ModelInfo[]> {
  return (await runtime.getAvailable()).map((m) => modelInfo(runtime, m));
}
