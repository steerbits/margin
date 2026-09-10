import {
  parseSkillBlock,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { Message, ToolView } from "../shared/types.ts";

type Part = {
  type: string;
  text?: string;
  thinking?: string;
  data?: string;
  mimeType?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
};
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return (content as Part[])
    .filter((x) => x.type === "text")
    .map((x) => x.text ?? "")
    .join("\n");
}
export function images(content: unknown): Message["images"] {
  return Array.isArray(content)
    ? content
        .filter(
          (x) =>
            x.type === "image" &&
            typeof x.data === "string" &&
            typeof x.mimeType === "string",
        )
        .map((x) => ({ data: x.data, mimeType: x.mimeType }))
    : [];
}
export function diffFrom(result: unknown): string | undefined {
  const d = (result as { details?: { patch?: unknown; diff?: unknown } })
    ?.details;
  return typeof d?.patch === "string"
    ? d.patch
    : typeof d?.diff === "string"
      ? d.diff
      : undefined;
}
export function transcript(entries: SessionEntry[]): Message[] {
  const out: Message[] = [];
  const tools = new Map<string, ToolView>();
  for (const e of entries) {
    if (e.type === "custom_message") {
      if (e.display)
        out.push({
          id: e.id,
          role: "custom",
          text: contentText(e.content),
          images: images(e.content),
          customType: e.customType,
          details: e.details,
        });
      continue;
    }
    if (e.type === "compaction") {
      out.push({
        id: e.id,
        role: "custom",
        text: "Context compacted. Earlier messages and their comments remain available here.",
      });
      continue;
    }
    if (e.type !== "message") continue;
    const m = e.message as unknown as {
      role: string;
      content: unknown;
      toolCallId?: string;
      toolName?: string;
      details?: unknown;
      isError?: boolean;
      errorMessage?: string;
      output?: string;
      command?: string;
    };
    if (m.role === "assistant") {
      const parts = Array.isArray(m.content) ? (m.content as Part[]) : [];
      const text = contentText(m.content),
        thinking = parts
          .filter((x) => x.type === "thinking")
          .map((x) => x.thinking ?? "")
          .join("\n");
      if (text || thinking || m.errorMessage)
        out.push({
          id: e.id,
          role: "assistant",
          text,
          thinking,
          error: m.errorMessage,
        });
      for (const p of parts.filter((x) => x.type === "toolCall")) {
        const tool: ToolView = {
          id: p.id!,
          name: p.name!,
          args: p.arguments,
          status: "running",
        };
        tools.set(tool.id, tool);
        out.push({ id: `tool:${tool.id}`, role: "tool", text: "", tool });
      }
    } else if (m.role === "toolResult") {
      const tool = tools.get(m.toolCallId!) ?? {
        id: m.toolCallId!,
        name: m.toolName ?? "tool",
        args: {},
        status: "running" as const,
      };
      if (!tools.has(tool.id))
        out.push({ id: `tool:${tool.id}`, role: "tool", text: "", tool });
      tool.result = { content: m.content, details: m.details };
      tool.status = m.isError ? "error" : "success";
      tool.diff = diffFrom(tool.result);
    } else if (m.role === "user") {
      const raw = contentText(m.content),
        skill = parseSkillBlock(raw);
      out.push({
        id: e.id,
        role: "user",
        text: skill ? (skill.userMessage ?? "") : raw,
        skill: skill?.name,
        images: images(m.content),
      });
    } else if (m.role === "bashExecution")
      out.push({
        id: e.id,
        role: "tool",
        text: "",
        tool: {
          id: e.id,
          name: "bash",
          args: { command: m.command },
          result: { content: [{ type: "text", text: m.output }] },
          status: m.isError ? "error" : "success",
        },
      });
    else if (
      m.role === "custom" &&
      (m as unknown as { display?: boolean }).display !== false
    )
      out.push({
        id: e.id,
        role: "custom",
        text: contentText(m.content),
        images: images(m.content),
        customType: (m as unknown as { customType?: string }).customType,
        details: m.details,
      });
  }
  return out;
}
