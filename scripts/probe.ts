import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { createModels } from "../server/models.ts";
const dir = resolve(".margin-data/probe");
await mkdir(dir, { recursive: true });
const modelRuntime = await createModels(dir);
const available = await modelRuntime.getAvailable("openai-codex");
console.log(
  "Available subscription models:",
  available.map((m) => m.id).join(", "),
);
const model =
  available.find(
    (m) => m.id === (process.env.MARGIN_PROBE_MODEL ?? "gpt-5.6-sol"),
  ) ?? available[0];
if (!model) throw new Error("No authenticated OpenAI Codex model.");
const loader = new DefaultResourceLoader({
  cwd: dir,
  agentDir: getAgentDir(),
  noExtensions: true,
  noSkills: true,
  noContextFiles: true,
});
await loader.reload();
const { session } = await createAgentSession({
  cwd: dir,
  modelRuntime,
  model,
  tools: [],
  resourceLoader: loader,
  sessionManager: SessionManager.inMemory(),
});
const kinds = new Set<string>();
session.subscribe((e) => {
  kinds.add(e.type);
});
try {
  await session.prompt(
    "Reply with exactly: Margin subscription connection works.",
  );
  const reply = session.messages.filter((m) => m.role === "assistant").at(-1);
  console.log(
    JSON.stringify(
      {
        provider: model.provider,
        model: model.id,
        subscription: modelRuntime.isUsingSubscription(model.provider),
        events: [...kinds],
        reply,
      },
      null,
      2,
    ),
  );
  if (!reply || reply.stopReason === "error" || !reply.content.length)
    throw new Error("The provider did not return a successful reply.");
} finally {
  session.dispose();
}
