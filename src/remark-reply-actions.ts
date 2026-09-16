import type { Root, RootContent, Text } from "mdast";

interface ReplyAction {
  type: "replyAction";
  children: Text[];
  data: {
    hName: "button";
    hProperties: { "data-reply-action": string };
  };
}
declare module "mdast" {
  interface RootContentMap {
    replyAction: ReplyAction;
  }
  interface PhrasingContentMap {
    replyAction: ReplyAction;
  }
}

/** A deliberately small, non-executable Markdown vocabulary. Opt-in per surface. */
export function remarkReplyActions() {
  return (tree: Root, file: { toString(): string }) => {
    const source = file.toString();
    function walk(parent: { children: RootContent[] }) {
      parent.children = parent.children.flatMap((node): RootContent[] => {
        // Never turn quoted content, code, or link labels into controls.
        if (["blockquote", "link", "linkReference"].includes(node.type))
          return [node];
        if (node.type !== "text") {
          if ("children" in node) walk(node);
          return [node];
        }
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        // Escaped/entity-decoded text must not acquire action semantics. Fall
        // back to ordinary Markdown rather than guess at transformed offsets.
        if (
          start === undefined ||
          end === undefined ||
          source.slice(start, end) !== node.value
        )
          return [node];
        const parts: RootContent[] = [];
        const pattern =
          /(?<![\w\\:]):reply\[([^\[\]\\\x00-\x1f\x7f]{1,500})\](?![\[{(])/gu;
        let at = 0;
        for (const match of node.value.matchAll(pattern)) {
          const label = match[1];
          if (!label.trim() || label !== label.trim()) continue;
          parts.push({
            type: "text",
            value: node.value.slice(at, match.index),
          });
          parts.push({
            type: "replyAction",
            children: [{ type: "text", value: label }],
            data: {
              hName: "button",
              hProperties: { "data-reply-action": label },
            },
          });
          at = match.index! + match[0].length;
        }
        if (!parts.length) return [node];
        parts.push({ type: "text", value: node.value.slice(at) });
        return parts;
      });
    }
    walk(tree);
  };
}
