import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:3000",
    },
  },
});
