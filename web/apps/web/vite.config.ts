import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { varlockVitePlugin } from "@varlock/vite-integration";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    port: 3001,
    host: true, // phones on the Wi-Fi open the dev UI directly
    // Go server (cmd/nimbrung) runs on :8080 in dev; UI only talks to /api.
    proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    varlockVitePlugin({ ssrInjectMode: "auto-load" }),
    tailwindcss(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
    }),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // The page itself always comes from the server (the jam needs it anyway),
      // so a rebuild shows on the next load instead of a stale cached copy.
      // Only the hashed assets are cached.
      workbox: { globPatterns: ["**/*.{js,css,png,svg,ico}"], navigateFallback: null },
      manifest: {
        name: "Nimbrung",
        short_name: "Nimbrung",
        description: "Queue songs to the host's YouTube Music from your phone",
        theme_color: "#0f0f11",
        background_color: "#0f0f11",
        display: "standalone",
        // Lets "Share → Nimbrung" from the YouTube Music app land on /add?url=…
        share_target: {
          action: "/add",
          method: "GET",
          params: { title: "title", text: "text", url: "url" },
        },
      },
      pwaAssets: { disabled: false, config: true },
      devOptions: { enabled: true },
    }),
  ],
});
