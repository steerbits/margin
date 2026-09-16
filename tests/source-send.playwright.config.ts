import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

// Exercise the real production send guard in a disposable native host; ordinary
// UI fixtures deliberately overlap source-workspace sessions and skip this guard.
export default defineConfig({
  testDir: "./source-send-browser",
  workers: 1,
  timeout: 30000,
  outputDir: "../.margin-data/source-send-test-results",
  use: {
    baseURL: "http://127.0.0.1:4346",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      PORT: "4346",
      MARGIN_AUTH_READ_ONLY: "1",
      MARGIN_TEST_SOURCE_SEND_GUARD: "1",
    },
    url: "http://127.0.0.1:4346",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
