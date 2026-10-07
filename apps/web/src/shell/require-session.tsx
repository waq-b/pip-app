import { useEffect } from "react";
import { Navigate } from "react-router";
import { UnauthenticatedError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useMe } from "../lib/me";
import { someRuleNeedsALook, useRules } from "../lib/rules";
import { useThisDevice } from "../lib/push";
import { AppShell } from "./app-shell";
import { Bell } from "./bell";
import { WarmingUp } from "./warming-up";

/**
 * The frontend's view of the two walls. It is cosmetic — the API refuses every
 * request that fails either check regardless (design rule 4) — but it
 * sends people to the right screen instead of a page of failures:
 *
 * signed out → sign in · signed in but not on the list → the refusal screen ·
 * allowed → the app.
 */
export function RequireSession() {
  const { state, signOut } = useAuth();
  const me = useMe(state.status === "signedIn");
  const allowed = me.data?.allowed === true;
  // Only asked once someone is in; a failure here just means no dot.
  const rules = useRules(allowed);
  // Every open: is this device still subscribed? Mends it quietly where it can.
  useThisDevice(allowed);
  const rejected = me.error instanceof UnauthenticatedError;

  // The browser holds a session the API won't accept — revoked, or expired
  // past refreshing. Clear it. Simply redirecting to sign-in would loop: the
  // sign-in screen sees a session and sends you straight back.
  useEffect(() => {
    if (rejected) void signOut();
  }, [rejected, signOut]);

  if (state.status === "loading") return <Waiting />;
  if (state.status === "signedOut") return <Navigate to="/sign-in" replace />;
  if (rejected) return <Waiting />;
  if (me.isError) return <CantReachPip />;
  if (!me.data) return <Waiting />;
  if (!me.data.allowed) return <Navigate to="/not-on-the-list" replace />;

  return (
    <AppShell
      userName={me.data.name ?? state.session.name ?? undefined}
      rulesNeedAttention={someRuleNeedsALook(rules.data)}
      bell={<Bell />}
    />
  );
}

/**
 * Pip is allowed to sleep, so the first answer after
 * a while can take up to a minute. Blank at first, then — after
 * `WARMING_AFTER_MS` — it says so in plain words, and the screen swaps itself
 * in when the answer arrives.
 */
function Waiting() {
  return <WarmingUp />;
}

function CantReachPip() {
  return (
    <main className="bg-ground text-ink grid min-h-svh place-items-center px-6 text-center">
      <div>
        <h1 className="font-heading m-0 text-xl font-normal">Can't reach Pip right now</h1>
        <p className="text-ink2 mt-2 text-sm">Your money is fine. Reload in a moment.</p>
      </div>
    </main>
  );
}
