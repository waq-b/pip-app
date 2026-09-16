import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

const API_ORIGIN = process.env.VITE_API_ORIGIN ?? "http://localhost:3001";

/**
 * The API's own paths, proxied in dev so the browser sees one origin. Without
 * this the session cookie is cross-site and simply isn't sent, and every
 * request 401s (docs/phases/phase-1.md).
 */
const API_PATHS = [
  "/auth",
  "/health",
  "/waitlist",
  "/portfolio",
  "/buckets",
  "/instruments",
  "/rules",
  "/activity",
  "/connections",
];

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
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
    proxy: Object.fromEntries(
      API_PATHS.map((path) => [path, { target: API_ORIGIN, changeOrigin: false }]),
    ),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: true,
  },
});
