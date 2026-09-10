import type { Message } from "../shared/types.ts";
import type { BrowserPluginContext } from "./plugin-api.ts";
import { browserPlugins } from "./plugins.ts";
import { PluginBoundary } from "./PluginBoundary.tsx";
import { Markdown } from "./Markdown.tsx";
export function CustomMessage({
  message,
  context,
}: {
  message: Message;
  context: (id: string) => BrowserPluginContext;
}) {
  const fallback = (
    <div className="custom-message">
      <Markdown text={message.text} />
      {message.images?.map((x, i) => (
        <img
          key={i}
          style={{ maxWidth: "100%" }}
          src={`data:${x.mimeType};base64,${x.data}`}
          alt="Extension output"
        />
      ))}
      {message.details !== undefined && (
        <details>
          <summary>Structured details</summary>
          <pre>{JSON.stringify(message.details, null, 2)}</pre>
        </details>
      )}
    </div>
  );
  for (const p of browserPlugins)
    try {
      const r = p.messageRenderers?.find((r) => r.matches(message));
      if (r) {
        const C = r.component;
        return (
          <PluginBoundary name={p.id} fallback={fallback}>
            <C message={message} context={context(p.id)} />
          </PluginBoundary>
        );
      }
    } catch {
      return fallback;
    }
  return fallback;
}
