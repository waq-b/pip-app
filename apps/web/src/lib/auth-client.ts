import { createClient, type Session } from "@supabase/supabase-js";

/**
 * What the app needs from sign-in, and nothing more. Supabase sits behind this
 * interface so screens never import it, and tests swap in a fake without a
 * Supabase project (CLAUDE.md hard line 7).
 */
export interface AuthSession {
  accessToken: string;
  email: string | null;
  name: string | null;
}

export interface AuthClient {
  /** The current session, refreshed by Supabase if its token was expiring. */
  getSession(): Promise<AuthSession | null>;
  /** Called on sign-in, sign-out and token refresh. Returns an unsubscribe. */
  onChange(listener: (session: AuthSession | null) => void): () => void;
  /** Leaves the page for Google. */
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

export function supabaseAuthClient(
  url: string | undefined = import.meta.env.VITE_SUPABASE_URL,
  publishableKey: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
): AuthClient {
  if (!url || !publishableKey) {
    throw new Error(
      "VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set — Pip can't sign anyone in without them",
    );
  }

  const supabase = createClient(url, publishableKey);

  return {
    async getSession() {
      const { data } = await supabase.auth.getSession();
      return toAuthSession(data.session);
    },

    onChange(listener) {
      const { data } = supabase.auth.onAuthStateChange((_event, session) =>
        listener(toAuthSession(session)),
      );
      return () => data.subscription.unsubscribe();
    },

    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
    },

    async signOut() {
      await supabase.auth.signOut();
    },
  };
}

function toAuthSession(session: Session | null): AuthSession | null {
  if (!session) return null;

  const metadata = session.user.user_metadata as
    { full_name?: unknown; name?: unknown } | undefined;
  const name =
    typeof metadata?.full_name === "string"
      ? metadata.full_name
      : typeof metadata?.name === "string"
        ? metadata.name
        : null;

  return { accessToken: session.access_token, email: session.user.email ?? null, name };
}
