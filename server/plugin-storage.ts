import type { Store } from "./store.ts";
import type { WorkspacePluginContext } from "./plugin-api.ts";

export function pluginStorage(
  store: Store,
  pluginId: string,
  projectId: string,
): WorkspacePluginContext["storage"] {
  const namespace = `plugin:${pluginId}:${projectId}`;
  return {
    get: <T>(key: string) => store.get<T>(namespace, key),
    set: (key, value) => store.put(namespace, key, value),
  };
}
