import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: "capture.spec.ts",
  workers: 1,
  timeout: 60000,
  outputDir: "../../.margin-data/temporary/readme-demos/results",
  use: {
    baseURL: "http://127.0.0.1:4356",
    viewport: { width: 1200, height: 760 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, "../.."),
    env: { PORT: "4356", MARGIN_AUTH_READ_ONLY: "1" },
    url: "http://127.0.0.1:4356",
    reuseExistingServer: false,
    timeout: 45000,
  },
});
