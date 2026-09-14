import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

export function markdownPage(text: string, title: string) {
  return (
    "<!doctype html>" +
    renderToStaticMarkup(
      <html>
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{title}</title>
          <style>{`
        * { box-sizing: border-box } body { margin:0; background:#fff; color:#242424; font:17px/1.75 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
        main { max-width:880px; padding:44px 48px 120px; margin:auto; overflow-wrap:anywhere; }
        h1,h2,h3 { line-height:1.25; margin:1.4em 0 .6em } h1 { font-size:2.1em; margin-top:0 }
        a { color:#2563eb } img { max-width:100% } pre { padding:20px; background:#f6f6f7; overflow:auto; border-radius:8px }
        code { font: .88em/1.65 ui-monospace,monospace } table { border-collapse:collapse; width:100%; margin:24px 0; }
        td,th { padding:10px 14px; border:1px solid #ddd; text-align:left } th { background:#f7f7f8 }
        blockquote { margin-left:0; border-left:3px solid #ddd; padding-left:20px; color:#666 }
        @media(max-width:600px) { main { padding:24px 20px 80px } }
      `}</style>
        </head>
        <body>
          <main>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              skipHtml
            >
              {text}
            </ReactMarkdown>
          </main>
        </body>
      </html>,
    )
  );
}
