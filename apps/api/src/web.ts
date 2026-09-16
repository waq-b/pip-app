import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";
import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

/**
 * Production serves the web app and the API from one origin, so there's no
 * CORS and the session token never crosses sites. `rewriteUrl` (see `app.ts`)
 * maps `/api/*` onto the API's own routes and everything else onto `/app/*`,
 * which this serves from the built web app — a real file if there is one,
 * otherwise `index.html` so client-side routes like `/rules` load the app.
 *
 * The static app is public: it's the sign-in screen and the code that runs
 * it, with no data in it. Every API route stays behind the guard.
 */
export const WEB_PREFIX = "/app";

export function rewriteForWebApp(url: string): string {
  if (url === "/api" || url.startsWith("/api/") || url.startsWith("/api?")) {
    return url.slice(4) || "/";
  }
  return `${WEB_PREFIX}${url}`;
}

/** Registered as a plugin so Fastify loads it in order during startup. */
export function registerWebApp(app: FastifyInstance, distDir: string): void {
  app.register(async (instance) => {
    await webApp(instance, distDir);
  });
}

async function webApp(app: FastifyInstance, distDir: string): Promise<void> {
  const root = resolve(distDir);
  if (!existsSync(resolve(root, "index.html"))) {
    throw new Error(`No built web app at ${root} — run the web build first`);
  }
  await app.register(fastifyStatic, { root, serve: false });

  app.get(`${WEB_PREFIX}/*`, async (request, reply) => {
    reply
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "same-origin")
      .header("x-frame-options", "DENY");

    const wanted = (request.params as { "*": string })["*"] ?? "";
    const file = resolve(root, wanted);
    const inside = !relative(root, file).startsWith("..");
    if (wanted && inside && existsSync(file) && statSync(file).isFile()) {
      // Vite fingerprints everything under assets/, so those never change.
      const immutable = wanted.startsWith("assets/");
      return reply.sendFile(relative(root, file), {
        maxAge: immutable ? "365d" : 0,
        immutable,
      });
    }
    // Never cached: a new deploy must be picked up on the next load.
    return reply
      .header("cache-control", "no-cache")
      .sendFile("index.html", { cacheControl: false });
  });
}
