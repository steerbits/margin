import { z } from "zod";
import type { PluginContext, ServerPlugin } from "../../server/plugin-api.ts";
import {
  isNote,
  MAX_NOTE_LENGTH,
  type Note,
  type SaveResult,
} from "./model.ts";

const saveInput = z
  .object({
    text: z.string().max(MAX_NOTE_LENGTH),
    revision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER - 1),
  })
  .strict();

function load(context: PluginContext): Note {
  const note = context.storage.get<unknown>("note");
  if (note === undefined) return { text: "", revision: 0 };
  if (!isNote(note))
    throw new Error("Stored project note is invalid; it has not been changed.");
  return note;
}

const plugin: ServerPlugin = {
  id: "project-notes",
  apiVersion: 1,
  onEvent(event, context) {
    if (event.type === "session.ready")
      context.publish({ note: load(context) });
  },
  action(name, input, context) {
    if (name === "load") {
      const note = load(context);
      context.publish({ note });
      return { note };
    }
    if (name !== "save") throw new Error("Unknown project-notes action.");
    const proposed = saveInput.parse(input);
    const current = load(context);
    if (proposed.revision !== current.revision) {
      context.publish({ note: current });
      return { saved: false, note: current } satisfies SaveResult;
    }
    // No await between revision check and write: actions are serialized by the
    // single host's event loop. Storage is already scoped to this plugin/project.
    const note = { text: proposed.text, revision: current.revision + 1 };
    context.storage.set("note", note);
    context.publish({ note });
    return { saved: true, note } satisfies SaveResult;
  },
};
export default plugin;
