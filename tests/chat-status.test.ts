import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatStatus } from "../src/ChatStatus.tsx";
import type { SessionActivity } from "../shared/types.ts";

const labels: Record<SessionActivity["status"], string> = {
  idle: "Ready",
  running: "Running",
  waiting: "Waiting for you",
  finished: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};
for (const [status, label] of Object.entries(labels)) {
  for (const unread of [false, true]) {
    test(`${status}${unread ? " unread" : ""} has a status-only visible and accessible label`, () => {
      const text = `${label}${unread ? " · Unread" : ""}`;
      const html = renderToStaticMarkup(
        createElement(ChatStatus, {
          activity: { status: status as SessionActivity["status"] },
          unread,
        }),
      );
      assert.equal(html.replace(/<[^>]+>/g, ""), text);
      assert.ok(
        html.includes(`role="status" aria-label="${text}" title="${text}"`),
      );
      assert.ok(html.includes('<i aria-hidden="true"></i>'));
      assert.doesNotMatch(html, /\bpi\b/i);
    });
  }
}
test("missing activity defaults to Ready without an agent prefix", () => {
  const html = renderToStaticMarkup(createElement(ChatStatus));
  assert.equal(html.replace(/<[^>]+>/g, ""), "Ready");
});
