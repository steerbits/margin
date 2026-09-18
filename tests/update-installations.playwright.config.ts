import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
export default defineConfig({
  testDir: "./update-installations-browser",
  workers: 1,
  timeout: 30000,
  outputDir: "../.margin-data/temporary/update-installations-results",
  use: {
    baseURL: "http://127.0.0.1:4351",
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
  },
  webServer: [
    { port: 4351, version: "1.0.0" },
    { port: 4352, version: "1.1.0" },
  ].map(({ port, version }) => ({
    command: "npx tsx tests/project-notes-server.ts",
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      PORT: String(port),
      MARGIN_AUTH_READ_ONLY: "1",
      MARGIN_TEST_INSTALLED_VERSION: version,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 45000,
  })),
});
