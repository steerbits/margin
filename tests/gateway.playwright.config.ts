import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./gateway-browser",
  workers: 1,
  timeout: 45000,
  outputDir: "../.margin-data/gateway-test-results",
  use: {
    baseURL: "http://127.0.0.1:4329",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    env: { PORT: "4329", MARGIN_AUTH_READ_ONLY: "1", MARGIN_GATEWAY_TEST: "1" },
    url: "http://127.0.0.1:4329",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
