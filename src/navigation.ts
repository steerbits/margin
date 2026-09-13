import type { Destination } from "../shared/navigation.ts";
export {
  chatUrl,
  workspaceUrl,
  customizeUrl,
  destinationUrl,
} from "../shared/navigation.ts";
export type { Destination } from "../shared/navigation.ts";

export interface NavigationRequest {
  destination: Destination;
  resolve: () => void;
  reject: (error: unknown) => void;
}
/** Browser plugins use the host's navigation, including its draft guards. */
export function navigate(destination: Destination): Promise<void> {
  return new Promise((resolve, reject) => {
    const event = new CustomEvent<NavigationRequest>("margin:navigate", {
      cancelable: true,
      detail: { destination, resolve, reject },
    });
    if (window.dispatchEvent(event))
      reject(new Error("Margin navigation is not ready."));
  });
}
