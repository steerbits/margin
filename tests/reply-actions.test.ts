import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkReplyActions } from "../src/remark-reply-actions.ts";
import {
  appendReplyAction,
  replyActionMessageId,
} from "../shared/reply-actions.ts";
import type { Message } from "../shared/types.ts";

const render = (text: string, enabled = true) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      children: text,
      skipHtml: true,
      remarkPlugins: enabled ? [remarkGfm, remarkReplyActions] : [remarkGfm],
    }),
  );

test("reply syntax renders inline, in lists/tables, and preserves surrounding text", () => {
  const html = render(
    "Choose :reply[Use your defaults and go] or :reply[Explain the tradeoff].\n\n- :reply[Use SQLite]\n\n| Next |\n| --- |\n| :reply[Continuer — oui!] |",
  );
  assert.equal((html.match(/<button /g) ?? []).length, 4);
  assert.ok(
    html.includes(
      'Choose <button data-reply-action="Use your defaults and go">Use your defaults and go</button> or',
    ),
  );
  assert.ok(html.includes('data-reply-action="Continuer — oui!"'));
  assert.ok(html.includes("<table>"));
});

for (const text of [
  "`:reply[Do not send]`",
  "```md\n:reply[Do not send]\n```",
  "    :reply[Do not send]",
  "> :reply[Do not send]",
  "[Link :reply[Do not send]](https://example.com)",
  "![Image :reply[Do not send]](https://example.com/image.png)",
  "[Link :reply[Do not send]][ref]\n\n[ref]: https://example.com",
  String.raw`\:reply[Do not send]`,
  "&#58;reply[Do not send]",
  "{Do not send}",
  ":reply[",
  ":reply[]",
  ":reply[   ]",
  ":reply[ with padding ]",
  ":reply[Two\nlines]",
  ":reply[**Formatting**]",
  ":reply[Label with [nested] brackets]",
  String.raw`:reply[Back\slash]`,
  ":reply[Unknown mode]{mode=insert}",
  ":reply[Link](https://example.com)",
  ":reply[Reference][ref]",
  ":future[Unknown capability]",
  "::reply[Block syntax]",
  "prefix:reply[Not standalone]",
  `:reply[${"x".repeat(501)}]`,
  '<button data-reply-action="Untrusted">Fake</button>',
]) {
  test(`non-action Markdown stays inert: ${text.slice(0, 65)}`, () => {
    assert.ok(!render(text).includes("<button"));
  });
}

test("reply parsing is opt-in and safe text is escaped, not executed", () => {
  assert.ok(!render(":reply[Go]", false).includes("<button"));
  assert.ok(
    render(':reply[Say "yes" & go]').includes(
      'data-reply-action="Say &quot;yes&quot; &amp; go"',
    ),
  );
  assert.ok(!render(":reply[<script>alert(1)</script>]").includes("<script>"));
});

test("append preserves partial drafts and whitespace, uses a new line, and is retry-idempotent", () => {
  for (const [draft, expected] of [
    ["", "Go"],
    ["Partial thought", "Partial thought\nGo"],
    ["Keep trailing spaces  ", "Keep trailing spaces  \nGo"],
    ["Already a line\n", "Already a line\nGo"],
    ["Two\n\n", "Two\n\nGo"],
    ["Go", "Go"],
    ["Partial thought\nGo", "Partial thought\nGo"],
    [
      "Partial thought\nGo\n\nNewer typing",
      "Partial thought\nGo\n\nNewer typing",
    ],
    ["Not Go", "Not Go\nGo"],
  ]) {
    assert.equal(appendReplyAction(draft, "Go"), expected);
    assert.equal(appendReplyAction(expected, "Go"), expected);
  }
});

test("only the latest completed, successful assistant message may send", () => {
  const message = (id: string, role: Message["role"], extra = {}): Message => ({
    id,
    role,
    text: ":reply[Go]",
    ...extra,
  });
  const first = message("first", "assistant");
  assert.equal(replyActionMessageId([]), undefined);
  assert.equal(replyActionMessageId([first]), "first");
  assert.equal(
    replyActionMessageId([first, message("user", "user")]),
    undefined,
  );
  assert.equal(
    replyActionMessageId([first, message("next", "assistant")]),
    "next",
  );
  assert.equal(
    replyActionMessageId([
      first,
      message("next", "assistant", { streaming: true }),
    ]),
    undefined,
  );
  assert.equal(
    replyActionMessageId([
      first,
      message("next", "assistant", { error: "Interrupted" }),
    ]),
    undefined,
  );
  assert.equal(replyActionMessageId([first, message("tool", "tool")]), "first");
});
