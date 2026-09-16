import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./browser",
  testMatch:
    /(?:ai-connections|provider-accounts|settings|model-picker)\.spec\.ts/,
  workers: 1,
  grepInvert: /real native host exposes read-only/,
  timeout: 45000,
  outputDir: "../.margin-data/connections-test-results",
  use: {
    baseURL: "http://127.0.0.1:4348",
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    env: { PORT: "4348", MARGIN_AUTH_READ_ONLY: "0" },
    url: "http://127.0.0.1:4348",
    reuseExistingServer: false,
    timeout: 45000,
  },
});
