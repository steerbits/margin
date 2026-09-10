import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
import base from "../playwright.config.ts";

// Never reuse or stop the user's app (4317) or existing test server (4318).
export default defineConfig({
  ...base,
  testDir: "./browser",
  outputDir: "../.margin-data/project-notes-test-results",
  use: { ...base.use, baseURL: "http://127.0.0.1:4328" },
  webServer: {
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      MARGIN_AUTH_READ_ONLY: "1",
      PORT: "4328",
    },
    url: "http://127.0.0.1:4328",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
