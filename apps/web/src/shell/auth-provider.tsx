import { useEffect, useMemo, useState, type ReactNode } from "react";
import { configureApiAuth } from "../lib/api";
import type { AuthClient, AuthSession } from "../lib/auth-client";
import { AuthContext, type AuthState } from "../lib/auth-context";

/**
 * Holds who is signed in, and hands the API client a way to fetch the current
 * token. The token is read fresh on every request rather than cached here, so a
 * refresh Supabase has just done is always the one sent.
 */
export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    configureApiAuth(async () => (await client.getSession())?.accessToken);

    let live = true;
    const apply = (session: AuthSession | null) => {
      if (!live) return;
      // Hand back the same object when nothing changed. A fresh one would
      // re-render every consumer — and anything that reacts to auth by signing
      // out would sign out again, forever.
      setState((previous) => {
        if (!session) return previous.status === "signedOut" ? previous : { status: "signedOut" };
        if (
          previous.status === "signedIn" &&
          previous.session.accessToken === session.accessToken
        ) {
          return previous;
        }
        return { status: "signedIn", session };
      });
    };

    client.getSession().then(apply, () => apply(null));
    const stop = client.onChange(apply);

    return () => {
      live = false;
      stop();
    };
  }, [client]);

  // Stable for the life of the client, so effects that depend on them don't re-run
  // every time the session changes.
  const actions = useMemo(
    () => ({
      sendMagicLink: (email: string) => client.sendMagicLink(email),
      signOut: () => client.signOut(),
    }),
    [client],
  );

  const value = useMemo(() => ({ state, ...actions }), [state, actions]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
