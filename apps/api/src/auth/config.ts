import type { AuthConfig } from "@auth/core";
import type { Adapter } from "@auth/core/adapters";
import Google from "@auth/core/providers/google";
import type { AllowlistStore } from "./allowlist.js";

/** Auth.js is mounted here; the web app proxies the same path in dev. */
export const AUTH_BASE_PATH = "/auth";

/**
 * Where a rejected sign-in lands. The screen names the address back to the
 * person and offers the waiting list (task 8 attaches the signed token).
 */
export const NOT_ALLOWED_PATH = "/not-on-the-list";

/**
 * Sessions roll forward while you're using the app and die 12 hours after you
 * stop. The 7-day absolute cap can't be expressed here — Auth.js only has a
 * rolling window — so `sessions.created_at` carries it and the route guard
 * enforces it.
 */
export const SESSION_IDLE_SECONDS = 12 * 60 * 60;
export const SESSION_ABSOLUTE_SECONDS = 7 * 24 * 60 * 60;

export interface AuthConfigOptions {
  store: AllowlistStore;
  adapter: Adapter;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
  /** Cookies are only marked Secure when we're actually on https. */
  useSecureCookies: boolean;
}

export function buildAuthConfig(options: AuthConfigOptions): AuthConfig {
  return {
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    adapter: options.adapter,
    // Behind the Vite proxy in dev and a single origin in prod, so the host
    // header is ours.
    trustHost: true,
    useSecureCookies: options.useSecureCookies,
    session: {
      strategy: "database",
      maxAge: SESSION_IDLE_SECONDS,
      // Refresh at most hourly so every request isn't a write.
      updateAge: 60 * 60,
    },
    providers: [
      Google({
        clientId: options.googleClientId,
        clientSecret: options.googleClientSecret,
      }),
    ],
    callbacks: {
      async signIn({ user, profile }) {
        const email = profile?.email ?? user.email;
        if (!email) return NOT_ALLOWED_PATH;

        // Google tells us whether it verified the address. An unverified one
        // proves nothing about who this is.
        if (profile && profile.email_verified === false) return NOT_ALLOWED_PATH;

        return (await options.store.isAllowed(email)) ? true : NOT_ALLOWED_PATH;
      },
    },
  };
}

/** Reads the environment, failing loudly rather than starting half-configured. */
export function authConfigFromEnv(store: AllowlistStore, adapter: Adapter): AuthConfig {
  const secret = required("AUTH_SECRET");
  const googleClientId = required("AUTH_GOOGLE_ID");
  const googleClientSecret = required("AUTH_GOOGLE_SECRET");

  return buildAuthConfig({
    store,
    adapter,
    secret,
    googleClientId,
    googleClientSecret,
    useSecureCookies: useSecureCookiesFromEnv(),
  });
}

/**
 * The cookie name changes with the `__Secure-` prefix, so the guard and the
 * Auth.js config must agree on this — hence one function, read by both.
 */
export function useSecureCookiesFromEnv(): boolean {
  return (process.env.AUTH_URL ?? "").startsWith("https://");
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — auth cannot start without it`);
  }
  return value;
}
