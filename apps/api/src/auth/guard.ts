import type { FastifyInstance, FastifyReply } from "fastify";
import { AUTH_BASE_PATH } from "./config.js";
import { sessionCookieName, type SessionStore, type SessionUser } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionUser?: SessionUser;
  }
}

/**
 * The only paths that answer without a session (CLAUDE.md hard line 4):
 * `/health` for ops, and the login flow itself. Everything else is 401 until
 * proven otherwise — a new route is protected by existing, not by anyone
 * remembering to protect it.
 */
export const PUBLIC_PATHS = ["/health"];

export function isPublicPath(path: string): boolean {
  if (PUBLIC_PATHS.includes(path)) return true;
  return path === AUTH_BASE_PATH || path.startsWith(`${AUTH_BASE_PATH}/`);
}

export interface SessionGuardOptions {
  store: SessionStore;
  useSecureCookies: boolean;
}

/**
 * Registered directly on the root instance rather than through `register`, so
 * the hook isn't encapsulated into a child scope and genuinely covers every
 * route, including ones added later.
 */
export function registerSessionGuard(app: FastifyInstance, options: SessionGuardOptions): void {
  const cookieName = sessionCookieName(options.useSecureCookies);

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? request.url;
    if (isPublicPath(path)) return;

    const token = readCookie(request.headers.cookie, cookieName);
    // No cookie means no store lookup, so refusing an unauthenticated request
    // never needs a database.
    if (!token) return unauthenticated(reply);

    const user = await options.store.find(token);
    if (!user) return unauthenticated(reply);

    request.sessionUser = user;
  });
}

function unauthenticated(reply: FastifyReply) {
  return reply.status(401).send({ error: "unauthenticated" });
}

/** Session tokens are base64-ish and can contain `=`, so split on the first one only. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) !== name) continue;
    return decodeURIComponent(trimmed.slice(separator + 1));
  }

  return undefined;
}
