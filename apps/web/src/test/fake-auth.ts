import { vi } from "vitest";
import type { AuthClient, AuthSession } from "../lib/auth-client";

/**
 * Stands in for Supabase in tests: a session the test chooses, and sign-in and
 * sign-out calls it can assert on. No Supabase project, no network.
 */
export function fakeAuthClient(initial: AuthSession | null = null) {
  let session = initial;
  const listeners = new Set<(session: AuthSession | null) => void>();

  const setSession = (next: AuthSession | null) => {
    session = next;
    for (const listener of listeners) listener(next);
  };

  const client = {
    getSession: vi.fn(async () => session),
    onChange: (listener: (session: AuthSession | null) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    sendMagicLink: vi.fn<(email: string) => Promise<void>>(async () => {}),
    signOut: vi.fn(async () => setSession(null)),
    setSession,
  } satisfies AuthClient & { setSession: typeof setSession };

  return client;
}

export const WAQAR: AuthSession = {
  accessToken: "token-for-waqar",
  email: "test@example.com",
  name: "Waqar",
};

export const SAM: AuthSession = {
  accessToken: "token-for-sam",
  email: "sam@example.com",
  name: "Sam",
};
