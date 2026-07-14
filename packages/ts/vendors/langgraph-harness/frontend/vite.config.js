import { defineConfig } from "vite";

// Dev: `npm run dev -w frontend` proxies /api to the backend (default :7100).
// Prod: `npm run build -w frontend` emits dist/, which the backend serves.
export default defineConfig({
  server: {
    port: 7101,
    proxy: {
      "/api": {
        target: process.env.LANGGRAPH_LANGCHAIN_HARNESS_API_URL ?? "http://127.0.0.1:7100",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
