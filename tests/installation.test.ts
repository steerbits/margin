import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { configureInstallation } from "../scripts/installation.ts";

test("installation overrides an inherited global Pi location and keeps private state under its data root", () => {
  const root = mkdtempSync(join(tmpdir(), "margin-installation-unit-"));
  try {
    const global = join(root, "unrelated-pi");
    mkdirSync(global);
    writeFileSync(join(global, "auth.json"), "unchanged");
    const environment = { MARGIN_DATA_DIR: join(root, "data with spaces"), PI_CODING_AGENT_DIR: global };
    const result = configureInstallation(join(root, "app"), environment);
    assert.equal(result.piDir, join(root, "data with spaces", "pi"));
    assert.equal(environment.PI_CODING_AGENT_DIR, result.piDir);
    assert.equal(readFileSync(join(global, "auth.json"), "utf8"), "unchanged");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Pi's real default credential storage follows the launcher directory and survives a fresh runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "margin-installation-sdk-"));
  try {
    const installation = pathToFileURL(resolve("scripts/installation.ts")).href;
    const code = `
      import assert from 'node:assert/strict';
      import {readFileSync,statSync} from 'node:fs';
      import {join} from 'node:path';
      import {configureInstallation} from ${JSON.stringify(installation)};
      const paths = configureInstallation(process.cwd());
      const {getAgentDir,ModelRuntime} = await import('@earendil-works/pi-coding-agent');
      assert.equal(getAgentDir(),paths.piDir);
      globalThis.fetch=async()=>{throw new Error('Unexpected network request in credential-storage test')};
      const first=await ModelRuntime.create({modelsPath:null});
      await first.login('anthropic','api_key',{notify(){},async prompt(){return 'installation-fixture-not-a-real-key'}});
      const file=join(paths.piDir,'auth.json');
      assert.equal(JSON.parse(readFileSync(file,'utf8')).anthropic.key,'installation-fixture-not-a-real-key');
      assert.equal(statSync(file).mode & 0o777,0o600);
      const second=await ModelRuntime.create({modelsPath:null});
      assert.ok((await second.listCredentials()).some(x=>x.providerId==='anthropic'));
      console.log('Private SDK credentials persisted and reloaded without network access.');
    `;
    const result = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), "--input-type=module", "-e", code], {
      cwd: process.cwd(),
      env: { ...process.env, MARGIN_DATA_DIR: root, PI_CODING_AGENT_DIR: join(root, "must-not-use") },
      encoding: "utf8",
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
