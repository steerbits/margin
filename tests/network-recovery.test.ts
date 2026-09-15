import test from "node:test";
import assert from "node:assert/strict";
import {
  isNetworkInterruption,
  waitForNetworkRetry,
} from "../server/network-recovery.ts";

for (const error of [
  "WebSocket idle timeout after 300000ms",
  "terminated",
  "fetch failed",
  "Failed to fetch",
  "WebSocket error",
  "WebSocket closed before response.completed",
  "connect ECONNREFUSED",
  "getaddrinfo ENOTFOUND",
  "stream ended before a terminal response event",
]) {
  test(`network classifier accepts provider error: ${error}`, () => {
    assert.equal(
      isNetworkInterruption({
        role: "assistant",
        stopReason: "error",
        errorMessage: error,
      }),
      true,
    );
    assert.equal(
      isNetworkInterruption({
        role: "toolResult",
        stopReason: "error",
        errorMessage: error,
      }),
      false,
    );
    assert.equal(
      isNetworkInterruption({
        role: "assistant",
        stopReason: "aborted",
        errorMessage: error,
      }),
      false,
    );
  });
}
for (const error of [
  "401 Unauthorized",
  "403 Forbidden",
  "429 rate limit",
  "insufficient_quota",
  "WebSocket error: 401 unauthorized",
  "fetch failed: billing quota exceeded",
  "500 server error",
  "context length exceeded",
  "Tool timed out",
  "Unknown model",
]) {
  test(`network classifier rejects non-connectivity error: ${error}`, () => {
    assert.equal(
      isNetworkInterruption({
        role: "assistant",
        stopReason: "error",
        errorMessage: error,
      }),
      false,
    );
  });
}
test("Stop cancels a backoff immediately, even if already aborted", async () => {
  const controller = new AbortController();
  const pending = waitForNetworkRetry(60_000, controller.signal);
  controller.abort();
  await pending;
  await waitForNetworkRetry(60_000, controller.signal);
});
