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
import type { ModelInfo } from "../shared/types.ts";

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
        "Read-only login mode cannot refresh credentials. Run pi /login or restart Margin without MARGIN_AUTH_READ_ONLY.",
      );
    },
    delete: async () => {
      throw new Error("Read-only login mode cannot modify credentials.");
    },
  };
}
export async function createModels(dataDir: string) {
  return ModelRuntime.create({
    modelsStorePath: join(dataDir, "models-store.json"),
    ...(process.env.MARGIN_AUTH_READ_ONLY === "1"
      ? { credentials: readOnlyCredentials(join(getAgentDir(), "auth.json")) }
      : {}),
  });
}
export function modelInfo(runtime: ModelRuntime, model: Model<Api>): ModelInfo {
  return {
    ...modelFields(model),
    backend: "pi",
    subscription: runtime.isUsingSubscription(model.provider),
    thinkingLevels: getSupportedThinkingLevels(model),
  };
}
function modelFields(m: { id: string; provider: string; name: string }) {
  return { id: m.id, provider: m.provider, name: m.name };
}
export async function listModels(runtime: ModelRuntime): Promise<ModelInfo[]> {
  return (await runtime.getAvailable()).map((m) => modelInfo(runtime, m));
}
