import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from "react-markdown";
import { artifactOutputLink } from "../shared/artifact-links.ts";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { createContext, memo, useContext } from "react";
import { ArrowUpRight } from "lucide-react";
import { remarkReplyActions } from "./remark-reply-actions.ts";
import { requestArtifactReview } from "./ArtifactReview.tsx";

interface ReplyActions {
  onSend(text: string): void;
  disabledReason?: string;
}
const ReplyActionContext = createContext<ReplyActions | undefined>(undefined);

// Stable renderer identities preserve live selections across links, tables and
// reply buttons when the composer, comments, or action availability change.
const components: Components = {
  button: function ReplyButton({ node, children }) {
    const actions = useContext(ReplyActionContext);
    const label = node?.properties["data-reply-action"];
    if (!actions || typeof label !== "string") return <>{children}</>;
    return (
      <button
        type="button"
        className="reply-action"
        aria-label={`Send reply: ${label}`}
        title={
          actions.disabledReason ||
          "Send this reply with your current draft, saved comments, and attachments"
        }
        disabled={!!actions.disabledReason}
        onClick={(event) => {
          event.stopPropagation();
          // Selecting a passage across a button is not permission to send.
          if (event.detail && window.getSelection()?.toString()) return;
          actions.onSend(label);
        }}
      >
        <span>{label}</span>
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    );
  },
  a: ({ node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        if (
          !e.metaKey &&
          !e.ctrlKey &&
          !e.shiftKey &&
          props.href &&
          requestArtifactReview(props.href)
        )
          e.preventDefault();
      }}
    />
  ),
  img: ({ src, alt }) =>
    src?.startsWith("data:image/") ? (
      <img src={src} alt={alt ?? ""} />
    ) : (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || "View image"}
      </a>
    ),
  table: ({ node, ...props }) => (
    <div className="table-scroll">
      <table {...props} />
    </div>
  ),
};

export const Markdown = memo(function Markdown({
  text,
  artifactSessionId,
  replyActions,
}: {
  text: string;
  artifactSessionId?: string;
  replyActions?: ReplyActions;
}) {
  return (
    <ReplyActionContext.Provider value={replyActions}>
      <MarkdownContent
        text={text}
        artifactSessionId={artifactSessionId}
        withReplyActions={!!replyActions}
      />
    </ReplyActionContext.Provider>
  );
});

// Action state updates buttons through context without reparsing the Markdown.
const MarkdownContent = memo(function MarkdownContent({
  text,
  artifactSessionId,
  withReplyActions,
}: {
  text: string;
  artifactSessionId?: string;
  withReplyActions: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={
        withReplyActions ? [remarkGfm, remarkReplyActions] : [remarkGfm]
      }
      rehypePlugins={[rehypeHighlight]}
      skipHtml
      urlTransform={(url) =>
        (artifactSessionId &&
          artifactOutputLink(url, artifactSessionId, location.origin)) ||
        defaultUrlTransform(url)
      }
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});
