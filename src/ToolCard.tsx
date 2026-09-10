import {
  ChevronRight,
  CircleCheck,
  CircleAlert,
  LoaderCircle,
  Terminal,
  FileCode2,
} from "lucide-react";
import type { ToolView } from "../shared/types.ts";
import type { BrowserPluginContext } from "./plugin-api.ts";
import { browserPlugins } from "./plugins.ts";
import { PluginBoundary } from "./PluginBoundary.tsx";
function output(result: unknown): string {
  const c = (result as { content?: unknown })?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .filter((x) => x.type === "text")
      .map((x) => x.text)
      .join("\n");
  return result === undefined ? "" : JSON.stringify(result, null, 2);
}
export function ToolCard({
  tool,
  context,
}: {
  tool: ToolView;
  context: (id: string) => BrowserPluginContext;
}) {
  const args = tool.args as { command?: string; path?: string };
  const label = args?.path ?? args?.command ?? tool.name;
  const content = output(tool.result);
  const images = (
    tool.result as {
      content?: { type: string; data?: string; mimeType?: string }[];
    }
  )?.content;
  let custom = null,
    pluginName = "",
    pluginError = "";
  for (const p of browserPlugins) {
    try {
      const match = p.toolRenderers?.find((r) => r.matches(tool));
      if (match) {
        const Component = match.component;
        pluginName = p.id;
        custom = <Component tool={tool} context={context(p.id)} />;
        break;
      }
    } catch (e) {
      pluginError = `Plugin ${p.id}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const generic = (
    <>
      <details className="raw-data">
        <summary>Arguments</summary>
        <pre>{JSON.stringify(tool.args, null, 2)}</pre>
      </details>
      {tool.diff ? (
        <pre className="diff" aria-label="File changes">
          {tool.diff.split("\n").map((line, i) => (
            <span
              key={i}
              className={
                line.startsWith("+")
                  ? "added"
                  : line.startsWith("-")
                    ? "removed"
                    : line.startsWith("@")
                      ? "hunk"
                      : ""
              }
            >
              {line || " "}
              <br />
            </span>
          ))}
        </pre>
      ) : content ? (
        <pre className="tool-output">{content}</pre>
      ) : (
        <p className="muted">
          {tool.status === "running"
            ? "Waiting for output…"
            : "Completed without text output."}
        </p>
      )}
      {Array.isArray(images) &&
        images
          .filter((x) => x.type === "image" && x.data)
          .map((x, i) => (
            <img
              className="tool-image"
              key={i}
              src={`data:${x.mimeType};base64,${x.data}`}
              alt="Tool output"
            />
          ))}
      {tool.result !== undefined && (
        <details className="raw-data">
          <summary>Full structured result</summary>
          <pre>{JSON.stringify(tool.result, null, 2)}</pre>
        </details>
      )}
    </>
  );
  return (
    <details className={`tool-card ${tool.status}`}>
      <summary>
        <ChevronRight className="disclosure" size={14} />
        {tool.name === "bash" ? (
          <Terminal size={15} />
        ) : (
          <FileCode2 size={15} />
        )}
        <span className="tool-name">{tool.name}</span>
        <span className="tool-summary">{label}</span>
        {tool.status === "running" ? (
          <LoaderCircle size={14} className="spin" />
        ) : tool.status === "error" ? (
          <CircleAlert size={14} />
        ) : (
          <CircleCheck size={14} />
        )}
      </summary>
      <div className="tool-body">
        {pluginError && <p role="alert">{pluginError}</p>}
        {custom ? (
          <PluginBoundary name={pluginName} fallback={generic}>
            {custom}
          </PluginBoundary>
        ) : (
          generic
        )}
      </div>
    </details>
  );
}
