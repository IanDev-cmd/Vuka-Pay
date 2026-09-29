import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png"],
      manifest: {
        name: "VukaPay - EAC Cross-Border Escrow",
        short_name: "VukaPay",
        display: "standalone",
        theme_color: "#000000",
        background_color: "#000000",
        start_url: "/",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,png,svg,woff2}"],
        navigateFallback: "index.html",
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/v1": "http://127.0.0.1:3000",
    },
  },
});
