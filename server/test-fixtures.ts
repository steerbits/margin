import type express from "express";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Store } from "./store.ts";
import type { LiveSession } from "./sessions.ts";
import { transcript } from "./transcript.ts";
import type { SessionInfo } from "../shared/types.ts";

export const fixtureMarkdown = `# A focused meeting-notes app

Here’s a starting point. Let’s shape it together before implementation.

## 1. Start with the core loop

Create a note, capture the discussion, and turn decisions into **a short list of action items**. Keep the first version focused on that loop.

| Feature | First version | Later |
| --- | --- | --- |
| Notes | Rich-text editor and search | Templates and attachments |
| Accounts | Email and password sign-in | Shared workspaces and roles |
| Storage | Hosted database with offline cache | Version history and live sync |

## 2. Choose a storage approach

Use a hosted database with a local cache. [SQLite](https://www.sqlite.org/docs.html) is another option. Store notes in \`notes.db\`.

\`\`\`typescript
const storage = "sqlite";
await saveNote({ title: "Weekly check-in" });
\`\`\`

## 3. Decide what matters most

- [ ] Review the scope above
- [ ] Choose where notes live
- [ ] Start with one useful flow

> What would make this useful in your next meeting?

I’ll wait for your feedback before making changes.`;
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
export function installFixtures(
  app: express.Express,
  { store, getLive }: { store: Store; getLive: (id: string) => LiveSession },
) {
  app.post("/api/test/customization-file", (req, res) => {
    if (process.env.MARGIN_DISPOSABLE_TEST_APP !== "1") {
      res
        .status(400)
        .json({ error: "This fixture requires the disposable test app." });
      return;
    }
    const path = join(
      resolve(dirname(fileURLToPath(import.meta.url)), ".."),
      "checkpoint-example.txt",
    );
    if (req.body.remove) {
      if (existsSync(path)) rmSync(path);
    } else writeFileSync(path, String(req.body.text ?? "example"));
    res.json({ ok: true });
  });
  app.post("/api/test/seed", async (req, res, next) => {
    try {
      const info: SessionInfo = {
        id: randomUUID(),
        projectId: store
          .projects()
          .find(
            (p) =>
              resolve(p.path) ===
              resolve(dirname(fileURLToPath(import.meta.url)), ".."),
          )!.id,
        title: String(req.body.title ?? "Meeting notes app").slice(0, 64),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      store.put("session", info.id, info);
      const l = getLive(info.id);
      await l.ready;
      const append = (role: "assistant" | "user", text: string) =>
        l.agent.sessionManager.appendMessage(
          role === "user"
            ? { role, content: text, timestamp: Date.now() }
            : {
                role,
                content: [{ type: "text", text }],
                api: "openai-codex-responses",
                provider: "openai-codex",
                model: "fixture",
                usage,
                stopReason: "stop",
                timestamp: Date.now(),
              },
        );
      const historyCount = Math.min(
        12,
        Math.max(0, Number(req.body.historyCount) || 0),
      );
      for (let i = 0; i < historyCount; i++) {
        append("user", `Earlier request ${i + 1}`);
        append(
          "assistant",
          `## Earlier reply ${i + 1}\n\n${Array.from({ length: 8 }, (_, n) => `Earlier paragraph ${n + 1}. This is prior conversation context to exercise reading and commenting near the end of a long thread.`).join("\n\n")}`,
        );
      }
      append(
        "user",
        "Help me plan a small meeting-notes app. Start with a proposal before writing code.",
      );
      append("assistant", fixtureMarkdown);
      l.messages = transcript(l.agent.sessionManager.getBranch());
      l.busy = false;
      l.agent.prompt = async (text, options) => {
        options?.preflightResult?.(true);
        append("user", text);
        l.busy = true;
        l.messages = transcript(l.agent.sessionManager.getBranch());
        l.changed();
        await new Promise((r) =>
          setTimeout(
            r,
            Math.min(3000, Math.max(0, Number(req.body.responseDelay) || 80)),
          ),
        );
        append(
          "assistant",
          "## Revised direction\n\nI received your inline comments and overall reply. I will use **local SQLite**, keep accounts out of the first version, and wait for your remaining decisions.\n\nWhat would you like to adjust next?",
        );
        l.messages = transcript(l.agent.sessionManager.getBranch());
        l.busy = false;
        l.changed();
      };
      l.changed();
      res.json({ id: info.id, snapshot: l.snapshot() });
    } catch (e) {
      next(e);
    }
  });
  app.post("/api/test/:id/dialog", async (req, res, next) => {
    try {
      const l = getLive(String(req.params.id));
      await l.ready;
      const kind = req.body.kind ?? "select";
      void l.ui
        .request(
          kind,
          req.body.title ?? "Choose a storage approach",
          {
            options:
              kind === "select" ? ["SQLite", "Hosted database"] : undefined,
            message: "Your answer returns to the waiting interaction.",
          },
          req.body.timeout === undefined
            ? undefined
            : { timeout: req.body.timeout },
        )
        .then((value) => {
          store.put("test-answer", l.info.id, {
            value,
            wasUndefined: value === undefined,
          });
          l.changed();
        })
        .catch((e) =>
          store.put("test-answer", l.info.id, { error: e.message }),
        );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.get("/api/test/:id/answer", (req, res) =>
    res.json(store.get("test-answer", String(req.params.id)) ?? {}),
  );
  app.post("/api/test/:id/plugin-output", (req, res) => {
    const l = getLive(String(req.params.id));
    l.agent.sessionManager.appendCustomMessageEntry(
      "lab-card",
      "Fallback custom message",
      true,
      { value: "structured value" },
    );
    l.messages = transcript(l.agent.sessionManager.getBranch());
    l.messages.push({
      id: "broken-renderer",
      role: "tool",
      text: "",
      tool: {
        id: "broken-renderer",
        name: "broken_renderer",
        args: {},
        status: "success",
        result: {
          content: [
            {
              type: "text",
              text: "Readable output survives a broken renderer.",
            },
          ],
        },
      },
    });
    l.changed();
    res.json({ ok: true });
  });
  app.post("/api/test/:id/delay-preflight", (req, res) => {
    const l = getLive(String(req.params.id));
    const original = l.agent.prompt;
    l.agent.prompt = async (text, options) => {
      await l.ui.request("confirm", "Accept this submission?");
      await original.call(l.agent, text, options);
    };
    res.json({ ok: true });
  });
  app.post("/api/test/:id/tools", (req, res) => {
    const l = getLive(String(req.params.id));
    l.messages.push(
      {
        id: "bash-failed",
        role: "tool",
        text: "",
        tool: {
          id: "bash-failed",
          name: "bash",
          args: { command: "rg missing-pattern notes.txt" },
          status: "error",
          result: {
            content: [{ type: "text", text: "Command exited with code 1" }],
          },
        },
      },
      {
        id: "bash-done",
        role: "tool",
        text: "",
        tool: {
          id: "bash-done",
          name: "bash",
          args: { command: "printf done" },
          status: "success",
          result: { content: [{ type: "text", text: "done" }] },
        },
      },
      {
        id: "tool:edit-fixture",
        role: "tool",
        text: "",
        tool: {
          id: "edit-fixture",
          name: "edit",
          args: {
            path: "notes.ts",
            edits: [{ oldText: "hosted", newText: "sqlite" }],
          },
          result: {
            content: [
              { type: "text", text: "Successfully replaced text in notes.ts." },
            ],
            details: {
              patch:
                '--- a/notes.ts\n+++ b/notes.ts\n@@ -1 +1 @@\n-const storage = "hosted";\n+const storage = "sqlite";',
            },
          },
          diff: '--- a/notes.ts\n+++ b/notes.ts\n@@ -1 +1 @@\n-const storage = "hosted";\n+const storage = "sqlite";',
          status: "success",
        },
      },
      {
        id: "tool:unknown-fixture",
        role: "tool",
        text: "",
        tool: {
          id: "unknown-fixture",
          name: "future_project_tool",
          args: { task: "inspect" },
          result: {
            content: [
              {
                type: "text",
                text: "An unfamiliar tool still has readable output.",
              },
            ],
            details: { newCapability: { count: 3 } },
          },
          status: "success",
        },
      },
    );
    l.changed();
    res.json({ ok: true });
  });
}
