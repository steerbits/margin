import type express from "express";
import { randomUUID } from "node:crypto";
import { writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { ArtifactStore } from "./artifacts.ts";
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
  const artifactFixtures = new Map<
    string,
    { root: string; vite: import("vite").ViteDevServer }
  >();
  const appScript = (updated = false) => `export function render() {
    document.querySelector('#app').innerHTML = '<h1>${updated ? "Updated dashboard" : "Review dashboard"}</h1><p>A local app with real interactions.</p><a href="/details">Details</a> <button id="open">Open settings</button><output id="hits">0</output><dialog id="settings"><h2>Settings</h2><button id="save">${updated ? "Apply changes" : "Save"}</button></dialog>';
    document.querySelector('#open').onclick = () => document.querySelector('#settings').showModal();
    document.querySelector('#save').addEventListener('pointerdown', () => document.querySelector('#hits').textContent = String(Number(document.querySelector('#hits').textContent) + 1));
  } render(); if (import.meta.hot) import.meta.hot.accept();`;
  app.post("/api/test/:id/artifact-fixtures", async (req, res, next) => {
    try {
      if (process.env.MARGIN_DISPOSABLE_TEST_APP !== "1")
        throw new Error("Artifact fixtures require a disposable test app.");
      const id = String(req.params.id),
        l = getLive(id);
      await l.ready;
      const root = join(l.project.path, "artifact-fixture", id);
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, "report.md"),
        "# Quarterly review\n\nRevenue grew steadily, but retention needs attention.\n\n| Metric | Value |\n| --- | --- |\n| Revenue | 42 |\n| Retention | 81% |\n\n**What should we explore next?**\n",
      );
      writeFileSync(
        join(root, "page.html"),
        '<!doctype html><html><head><title>HTML report</title><link rel="stylesheet" href="./style.css"></head><body><h1>HTML report</h1><p id="summary">A static report worth reviewing.</p><button id="action" onclick="this.textContent=\'Activated\'">Try button</button></body></html>',
      );
      writeFileSync(
        join(root, "style.css"),
        "body { font:18px/1.7 system-ui; padding:50px; color:#243044; } button { padding:12px 20px; font:inherit; } dialog { border:1px solid #ccc; border-radius:12px; padding:32px; }",
      );
      writeFileSync(
        join(root, "index.html"),
        '<!doctype html><html><head><title>Review dashboard</title><link rel="stylesheet" href="/style.css"></head><body><main id="app"></main><script type="module" src="/main.js"></script></body></html>',
      );
      writeFileSync(join(root, "main.js"), appScript());
      const { createServer } = await import("vite");
      const vite = await createServer({
        root,
        configFile: false,
        server: { host: "127.0.0.1", port: 0 },
        logLevel: "error",
      });
      await vite.listen();
      const port = (
        vite.httpServer!.address() as import("node:net").AddressInfo
      ).port;
      artifactFixtures.set(id, { root, vite });
      if (req.body.rawLinks) {
        l.agent.sessionManager.appendMessage({
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Here are the generated outputs:\n\n[Read generated report](artifact-fixture/${id}/report.md)\n\n[Open HTML output](${join(root, "page.html")})\n\n[Open local dashboard](http://127.0.0.1:${port}/)\n\n[External documentation](https://example.com/docs.md)`,
            },
          ],
          api: "openai-codex-responses",
          provider: "openai-codex",
          model: "fixture",
          usage,
          stopReason: "stop",
          timestamp: Date.now(),
        });
        l.messages = transcript(l.agent.sessionManager.getBranch());
        l.changed();
        res.json({ root, appUrl: `http://127.0.0.1:${port}/` });
        return;
      }
      const artifacts = new ArtifactStore(store, id);
      const markdown = artifacts.register(l.project, {
        location: join(root, "report.md"),
        title: "Quarterly review",
      });
      const html = artifacts.register(l.project, {
        location: join(root, "page.html"),
        title: "HTML report",
      });
      const webapp = artifacts.register(l.project, {
        location: `http://127.0.0.1:${port}`,
        title: "Review dashboard",
      });
      res.json({ markdown, html, app: webapp, root });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/test/:id/artifact-update", (req, res) => {
    const fixture = artifactFixtures.get(String(req.params.id));
    if (!fixture) throw new Error("Fixture not found.");
    writeFileSync(join(fixture.root, "main.js"), appScript(true));
    res.json({ ok: true });
  });
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
      const historyCount = req.body.empty
        ? 0
        : Math.min(12, Math.max(0, Number(req.body.historyCount) || 0));
      for (let i = 0; i < historyCount; i++) {
        append("user", `Earlier request ${i + 1}`);
        append(
          "assistant",
          `## Earlier reply ${i + 1}\n\n${Array.from({ length: 8 }, (_, n) => `Earlier paragraph ${n + 1}. This is prior conversation context to exercise reading and commenting near the end of a long thread.`).join("\n\n")}`,
        );
      }
      if (!req.body.empty) {
        append(
          "user",
          "Help me plan a small meeting-notes app. Start with a proposal before writing code.",
        );
        append("assistant", fixtureMarkdown);
      }
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
      const accepted = await l.ui.request("confirm", "Accept this submission?");
      if (!accepted) {
        options?.preflightResult?.(false);
        return;
      }
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
