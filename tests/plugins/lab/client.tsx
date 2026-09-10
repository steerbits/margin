import { useState } from "react";
import type {
  BrowserPlugin,
  BrowserPluginContext,
} from "../../../src/plugin-api.ts";
function Panel(ctx: BrowserPluginContext) {
  const [text, setText] = useState("");
  return (
    <div>
      <p data-testid="plugin-note">
        {(ctx.state as { note?: string })?.note || "No project note"}
      </p>
      <input
        aria-label="Project note"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <button onClick={() => void ctx.action("save", { text })}>
        Save project note
      </button>
      <button onClick={() => void ctx.action("load", {})}>
        Reload project note
      </button>
    </div>
  );
}
const plugin: BrowserPlugin = {
  id: "lab",
  apiVersion: 1,
  panels: [{ id: "notes", title: "Lab notes", component: Panel }],
  messageActions: [
    {
      id: "quote",
      label: "Use as prompt",
      run: (message, ctx) => ctx.setComposer(message.text),
    },
  ],
  toolRenderers: [
    {
      matches: (tool) => tool.name === "broken_renderer",
      component: () => {
        throw null;
      },
    },
  ],
  messageRenderers: [
    {
      matches: (m) => m.customType === "lab-card",
      component: ({ message }) => (
        <div data-testid="custom-renderer">
          Custom card: {(message.details as { value: string }).value}
        </div>
      ),
    },
  ],
};
export default plugin;
