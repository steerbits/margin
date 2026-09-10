import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4318",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "MARGIN_TEST_MODE=1 MARGIN_AUTH_READ_ONLY=1 PORT=4318 MARGIN_DATA_DIR=.margin-data/e2e npx tsx server/index.ts",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
