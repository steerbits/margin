import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { buildIdentity, buildIdentityPlugin } from "./scripts/build-identity.ts";
const identity = buildIdentity(import.meta.dirname);
export default defineConfig({
  plugins: [react(), buildIdentityPlugin(identity)],
  define: {
    __MARGIN_BUILD_VERSION__: JSON.stringify(identity.version),
    "import.meta.env.MARGIN_TEST_MODE":
      process.env.MARGIN_TEST_MODE === "1" ? "true" : "false",
  },
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    fs: { deny: ["**/.git/**", "**/.env*", "**/.margin-data/**"] },
  },
});
