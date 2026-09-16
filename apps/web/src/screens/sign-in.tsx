import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../lib/auth-context";
import { ICON_STROKE } from "../shell/nav";
import { PipMark } from "../shell/pip-mark";
import { useBreakpoint } from "../shell/use-breakpoint";
import { GoogleMark } from "./google-mark";

/**
 * One button, no passwords, nothing to set up (DESIGN.md §7). The only screen
 * with neither a sidebar nor a hero number, so on desktop it keeps the phone's
 * proportions and gains a second column for the promise.
 *
 * The button hands off to Supabase, which takes the page to Google and brings
 * it back signed in. Whether that person is allowed in is the API's call.
 */
export function SignInScreen() {
  const { state, signInWithGoogle } = useAuth();
  const isDesktop = useBreakpoint() === "desktop";
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);

  if (state.status === "signedIn") return <Navigate to="/" replace />;

  const start = async () => {
    setFailed(false);
    setChecking(true);
    try {
      await signInWithGoogle();
    } catch {
      setChecking(false);
      setFailed(true);
    }
  };

  const signIn = (
    <SignInButton disabled={state.status === "loading"} failed={failed} onStart={start} />
  );

  if (isDesktop) {
    return (
      <main className="bg-ground text-ink grid min-h-svh place-items-center px-6">
        <div className="grid w-full max-w-[700px] grid-cols-[1fr_250px] items-center gap-10">
          <Promise size="desktop" />
          {checking ? (
            <Checking />
          ) : (
            <div className="bg-card flex flex-col gap-3.5 rounded-[26px] px-5 py-[22px]">
              <div className="text-ink2 text-[11px] font-bold tracking-[0.09em] uppercase">
                Sign in
              </div>
              {signIn}
            </div>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="bg-ground text-ink min-h-svh px-[18px] py-5">
      <div className="mx-auto max-w-[390px]">
        {checking ? (
          <Checking />
        ) : (
          <div className="bg-card flex flex-col items-start gap-4 rounded-[24px] px-5 pt-[30px] pb-6">
            <Promise size="phone" />
            {signIn}
          </div>
        )}
      </div>
    </main>
  );
}

function Promise({ size }: { size: "phone" | "desktop" }) {
  const isDesktop = size === "desktop";

  return (
    <div className="flex flex-col items-start gap-4">
      <PipMark size={isDesktop ? 46 : 52} />
      <h1
        className={`font-heading m-0 font-normal tracking-[-0.015em] ${
          isDesktop ? "text-[34px] leading-[1.14]" : "text-[27px] leading-[1.18]"
        }`}
      >
        Three pots.
        <br />
        One number.
        <br />
        No homework.
      </h1>
      <p
        className={`text-ink2 m-0 leading-normal font-medium ${isDesktop ? "text-sm" : "text-[13.5px]"}`}
      >
        Pip shows you your money in plain English. It can look, never touch.
      </p>
    </div>
  );
}

function SignInButton({
  disabled,
  failed,
  onStart,
}: {
  disabled: boolean;
  failed: boolean;
  onStart: () => void;
}) {
  return (
    <div className="w-full">
      <button
        type="button"
        onClick={onStart}
        disabled={disabled}
        className="border-line bg-ground text-ink flex w-full cursor-pointer items-center gap-3 rounded-full border-[1.5px] px-[18px] py-3.5 text-[14.5px] font-bold disabled:cursor-default disabled:opacity-45"
      >
        <GoogleMark />
        Continue with Google
      </button>
      {failed ? (
        <p role="alert" className="text-ink2 m-0 mt-3 text-[12.5px] leading-normal font-medium">
          Pip couldn't start sign-in. Give it a moment and try again.
        </p>
      ) : null}
      <p className="text-ink3 m-0 mt-4 text-[11.5px] leading-normal font-medium">
        Invite-only while it's young. Pip reads your name and email, nothing else.
      </p>
    </div>
  );
}

function Checking() {
  return (
    <section
      aria-live="polite"
      className="bg-card flex min-h-[262px] flex-col items-center justify-center gap-4 rounded-[24px] px-5 py-7 text-center"
    >
      <LoaderCircle
        size={30}
        strokeWidth={ICON_STROKE}
        className="text-acc animate-spin [animation-duration:1s]"
        aria-hidden
      />
      <h1 className="font-heading m-0 text-xl leading-tight font-normal">
        Checking you're on the list
      </h1>
      <p className="text-ink2 m-0 text-[12.5px] leading-normal font-medium">
        Two seconds. Pip is only asking Google who you are.
      </p>
    </section>
  );
}
