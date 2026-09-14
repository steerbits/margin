import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import { artifactOutputLink } from "../shared/artifact-links.ts";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { memo } from "react";
import { requestArtifactReview } from "./ArtifactReview.tsx";
// Keep DOM text nodes stable while comment/UI state changes, preserving live browser selections.
export const Markdown = memo(function Markdown({
  text,
  artifactSessionId,
}: {
  text: string;
  artifactSessionId?: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      skipHtml
      urlTransform={(url) =>
        (artifactSessionId &&
          artifactOutputLink(url, artifactSessionId, location.origin)) ||
        defaultUrlTransform(url)
      }
      components={{
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
      }}
    >
      {text}
    </ReactMarkdown>
  );
});
