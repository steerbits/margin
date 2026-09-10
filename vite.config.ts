import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.MARGIN_TEST_MODE":
      process.env.MARGIN_TEST_MODE === "1" ? "true" : "false",
  },
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    fs: { deny: ["**/.git/**", "**/.env*", "**/.margin-data/**"] },
  },
});
