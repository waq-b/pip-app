import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const API_ORIGIN = process.env.VITE_API_ORIGIN ?? "http://localhost:3001";

/**
 * The app calls the API under `/api`, proxied in dev with the prefix stripped.
 * A prefix rather than a list of the API's paths, because several of them are
 * also screens (`/rules`, `/instruments/:id`): proxying those sent a page load
 * or a reload straight to the API. Sign-in goes from the browser to Supabase,
 * not through here.
 */
const API_PREFIX = "/api";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits until src/update.ts applies it on launch, behind the
      // splash, so the page never reloads mid-use.
      registerType: "prompt",
      manifest: {
        name: "Pip",
        short_name: "Pip",
        description: "Three pots. One number. No homework.",
        start_url: "/",
        display: "standalone",
        background_color: "#ebddc5",
        theme_color: "#ebddc5",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      [API_PREFIX]: {
        target: API_ORIGIN,
        changeOrigin: false,
        rewrite: (path) => path.slice(API_PREFIX.length) || "/",
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
