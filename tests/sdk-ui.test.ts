import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { UiBridge } from "../server/ui-bridge.ts";

test("real SDK startup and extension-command dialogs use the HTML bridge without model inference", async () => {
  const dir = await mkdtemp(join(tmpdir(), "margin-sdk-"));
  const ui = new UiBridge(() => {});
  let startupAnswer: string | undefined;
  let commandAnswer: boolean | undefined;
  let mode: string | undefined;
  let authReads = 0;
  const models = await ModelRuntime.create({
    credentials: {
      read: async () => {
        authReads++;
        return undefined;
      },
      list: async () => [],
      modify: async () => {
        throw new Error("No credential writes in test");
      },
      delete: async () => {},
    },
    refreshOnCreate: false,
    modelsPath: null,
    modelsStorePath: join(dir, "models.json"),
  });
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager: settings,
    noExtensions: true,
    noSkills: true,
    noContextFiles: true,
    extensionFactories: [
      (pi) => {
        pi.on("session_start", async (_event, ctx) => {
          mode = ctx.mode;
          assert.equal(ctx.hasUI, true);
          startupAnswer = await ctx.ui.input("Startup question");
          ctx.ui.setStatus("startup", ctx.ui.theme.fg("success", "Ready"));
        });
        pi.registerCommand("compat-dialog", {
          description: "Compatibility test only",
          handler: async (_args, ctx) => {
            commandAnswer = await ctx.ui.confirm(
              "Command question",
              "Continue?",
            );
            ctx.ui.setEditorText("Text supplied by the extension");
          },
        });
      },
    ],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    modelRuntime: models,
    model: models.getModel("openai-codex", "gpt-5.6-sol"),
    tools: [],
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: SessionManager.inMemory(),
  });
  try {
    const binding = session.bindExtensions({
      mode: "rpc",
      uiContext: ui.context(),
    });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal([...ui.dialogs.values()][0]?.title, "Startup question");
    ui.answer([...ui.dialogs.keys()][0], "A real SDK answer");
    await binding;
    assert.equal(mode, "rpc");
    assert.equal(startupAnswer, "A real SDK answer");
    assert.equal(ui.statuses.startup, "Ready");
    const readsBeforeCommand = authReads;
    const command = session.prompt("/compat-dialog");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal([...ui.dialogs.values()][0]?.kind, "confirm");
    ui.answer([...ui.dialogs.keys()][0], false);
    await command;
    assert.equal(commandAnswer, false);
    assert.equal(ui.editorText, "Text supplied by the extension");
    assert.equal(authReads, readsBeforeCommand);
    assert.equal(session.messages.length, 0);
  } finally {
    ui.cancelAll();
    session.dispose();
    await rm(dir, { recursive: true, force: true });
  }
});
