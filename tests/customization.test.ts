import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  pluginCatalog,
  setPluginEnabled,
  pluginPreferences,
} from "../server/plugin-management.ts";
import { loadPlugins } from "../server/plugins.ts";
import { createWorkspace } from "../server/workspaces.ts";

test("disabled plugins are listed without importing their server code", async () => {
  const root = mkdtempSync(join(tmpdir(), "margin-plugin-controls-"));
  try {
    mkdirSync(join(root, "plugins", "broken"), { recursive: true });
    writeFileSync(
      join(root, "plugins/broken/server.ts"),
      'throw new Error("Must not execute");',
    );
    writeFileSync(
      join(root, "plugins/broken/README.md"),
      "# Broken\n\nTest plugin.",
    );
    setPluginEnabled(root, "broken", false);
    const catalog = pluginCatalog(root);
    assert.equal(catalog[0].enabled, false);
    assert.equal(catalog[0].description, "Test plugin.");
    assert.deepEqual(
      await loadPlugins(join(root, "plugins"), {
        disabled: new Set(pluginPreferences(root).disabled),
      }),
      [],
    );
    setPluginEnabled(root, "broken", true);
    assert.equal(pluginCatalog(root)[0].enabled, true);
    assert.match(
      readFileSync(join(root, "plugins/broken/server.ts"), "utf8"),
      /Must not execute/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("new workspace creates only a new named folder and rejects traversal and collisions", async () => {
  const root = mkdtempSync(join(tmpdir(), "margin-workspaces-"));
  try {
    const p = await createWorkspace(root, "My project");
    assert.equal(p.name, "My project");
    assert.equal(existsSync(join(root, "My project")), true);
    await assert.rejects(createWorkspace(root, "My project"));
    await assert.rejects(createWorkspace(root, "../escape"));
    await assert.rejects(createWorkspace(root, ".hidden"));
    assert.equal(existsSync(join(root, "escape")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
