import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./gateway-browser",
  testMatch: /(?:provider-accounts|settings)\.spec\.ts/,
  workers: 1,
  timeout: 45000,
  outputDir: "../.margin-data/connections-gateway-results",
  use: {
    baseURL: "http://127.0.0.1:4349",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    env: { PORT: "4349", MARGIN_AUTH_READ_ONLY: "1", MARGIN_GATEWAY_TEST: "1" },
    url: "http://127.0.0.1:4349",
    reuseExistingServer: false,
    timeout: 45000,
  },
});
