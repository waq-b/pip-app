import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { apiPost } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useMe } from "../lib/me";
import { PipMark } from "../shell/pip-mark";

/**
 * Pip is invite-only, so the door has to be able to say no kindly
 * (DESIGN.md §7). The person here is signed in — just not allowed — so asking
 * for the waiting list is an ordinary authenticated request, and the API takes
 * their address from their sign-in. No queue position, no countdown, and no
 * promise of an email: the owner lets people in by hand (DESIGN.md §6.5).
 */
export function NotOnTheListScreen() {
  const { state, signOut } = useAuth();
  const navigate = useNavigate();
  const me = useMe(state.status === "signedIn");
  const join = useMutation({ mutationFn: () => apiPost("/waitlist") });

  if (state.status === "signedOut") return <Navigate to="/sign-in" replace />;
  if (state.status === "loading" || me.isPending) return <Card busy />;
  if (me.data?.allowed) return <Navigate to="/" replace />;

  const email = me.data?.email ?? state.session.email;

  const differentAccount = async () => {
    await signOut();
    navigate("/sign-in", { replace: true });
  };

  if (join.isSuccess) {
    return (
      <Card>
        <h1 className="font-heading m-0 text-[23px] leading-[1.2] font-normal">
          You're on the waiting list
        </h1>
        <p className="text-ink2 m-0 text-[13.5px] leading-normal font-medium">
          Waqar will let you know when there's room. Nothing else to do.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="font-heading m-0 text-[23px] leading-[1.2] font-normal">
        You're not on the list — yet
      </h1>
      <p className="text-ink2 m-0 text-[13.5px] leading-normal font-medium">
        Pip is invite-only while it's small.
        {email ? (
          <>
            {" "}
            You signed in as <strong className="text-ink">{email}</strong>.
          </>
        ) : null}
      </p>

      <button
        type="button"
        onClick={() => join.mutate()}
        disabled={join.isPending}
        className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-5 py-3 text-left text-sm font-bold disabled:cursor-default disabled:opacity-45"
      >
        {join.isPending ? "Adding you…" : "Put me on the waiting list"}
      </button>

      {join.isError ? (
        <p role="alert" className="text-ink2 m-0 text-[12.5px] leading-normal font-medium">
          Couldn't add you just now. Try again in a moment.
        </p>
      ) : null}

      <button
        type="button"
        onClick={differentAccount}
        className="text-solid cursor-pointer border-0 bg-transparent p-0 text-left text-[13.5px] font-bold"
      >
        Try a different account
      </button>

      <p className="text-ink3 m-0 text-[11.5px] leading-normal font-medium">
        No queue position, no countdown. Waqar lets people in by hand.
      </p>
    </Card>
  );
}

function Card({ children, busy = false }: { children?: ReactNode; busy?: boolean }) {
  return (
    <main className="bg-ground text-ink min-h-svh px-[18px] py-5" aria-busy={busy || undefined}>
      <div className="bg-card mx-auto flex max-w-[390px] flex-col items-start gap-3.5 rounded-[24px] px-5 py-[26px]">
        <PipMark size={46} outline />
        {children}
      </div>
    </main>
  );
}
