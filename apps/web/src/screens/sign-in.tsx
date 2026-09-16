import { MailCheck } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Navigate } from "react-router";
import { TooManyEmailsError } from "../lib/auth-client";
import { useAuth } from "../lib/auth-context";
import { ICON_STROKE } from "../shell/nav";
import { PipMark } from "../shell/pip-mark";
import { useBreakpoint } from "../shell/use-breakpoint";

type Step =
  | { kind: "ask" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "failed"; message: string };

/**
 * No passwords, nothing to set up (DESIGN.md §7). Sign-in is an emailed magic
 * link for now (Waqar, 2026-09-16) — Google returns later. The only screen with
 * neither a sidebar nor a hero number, so on desktop it keeps the phone's
 * proportions and gains a second column for the promise.
 *
 * Anyone can ask for a link. Whether that person is allowed in is the API's
 * call, made once the link brings them back.
 */
export function SignInScreen() {
  const { state, sendMagicLink } = useAuth();
  const isDesktop = useBreakpoint() === "desktop";
  const [step, setStep] = useState<Step>({ kind: "ask" });

  if (state.status === "signedIn") return <Navigate to="/" replace />;

  const send = async (email: string) => {
    setStep({ kind: "sending" });
    try {
      await sendMagicLink(email);
      setStep({ kind: "sent", email });
    } catch (error) {
      setStep({
        kind: "failed",
        message:
          error instanceof TooManyEmailsError
            ? "Pip has sent too many sign-in emails for now. Try again in an hour, and use the newest link you have."
            : "Pip couldn't send the link. Give it a moment and try again.",
      });
    }
  };

  const panel =
    step.kind === "sent" ? (
      <Sent email={step.email} onRestart={() => setStep({ kind: "ask" })} />
    ) : (
      <EmailForm
        disabled={state.status === "loading"}
        sending={step.kind === "sending"}
        failure={step.kind === "failed" ? step.message : undefined}
        onSend={send}
      />
    );

  if (isDesktop) {
    return (
      <main className="bg-ground text-ink grid min-h-svh place-items-center px-6">
        <div className="grid w-full max-w-[700px] grid-cols-[1fr_250px] items-center gap-10">
          <Promise size="desktop" />
          <div className="bg-card flex flex-col gap-3.5 rounded-[26px] px-5 py-[22px]">
            <div className="text-ink2 text-[11px] font-bold tracking-[0.09em] uppercase">
              Sign in
            </div>
            {panel}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-ground text-ink min-h-svh px-[18px] py-5">
      <div className="mx-auto max-w-[390px]">
        <div className="bg-card flex flex-col items-start gap-4 rounded-[24px] px-5 pt-[30px] pb-6">
          <Promise size="phone" />
          {panel}
        </div>
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

function EmailForm({
  disabled,
  sending,
  failure,
  onSend,
}: {
  disabled: boolean;
  sending: boolean;
  failure?: string;
  onSend: (email: string) => void;
}) {
  const inputId = useId();
  const [email, setEmail] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = email.trim();
    if (trimmed) onSend(trimmed);
  };

  return (
    <form onSubmit={submit} className="w-full">
      <label
        htmlFor={inputId}
        className="text-ink2 mb-1.5 block text-[11px] font-bold tracking-[0.06em] uppercase"
      >
        Email
      </label>
      <input
        id={inputId}
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        disabled={disabled || sending}
        className="bg-sunk border-line text-ink placeholder:text-ink3 w-full rounded-2xl border-[1.5px] px-3.5 py-3 text-[14px]"
      />
      <button
        type="submit"
        disabled={disabled || sending || !email.trim()}
        className="bg-solid text-solid-ink mt-3 w-full cursor-pointer rounded-full border-0 px-[18px] py-3.5 text-[14.5px] font-bold disabled:cursor-default disabled:opacity-45"
      >
        {sending ? "Sending your link…" : "Email me a sign-in link"}
      </button>
      {failure ? (
        <p role="alert" className="text-ink2 m-0 mt-3 text-[12.5px] leading-normal font-medium">
          {failure}
        </p>
      ) : null}
      <p className="text-ink3 m-0 mt-4 text-[11.5px] leading-normal font-medium">
        Invite-only while it's young. No password — Pip only needs your email.
      </p>
    </form>
  );
}

function Sent({ email, onRestart }: { email: string; onRestart: () => void }) {
  return (
    <section aria-live="polite" className="flex w-full flex-col items-start gap-3">
      <MailCheck size={30} strokeWidth={ICON_STROKE} className="text-acc" aria-hidden />
      <h2 className="font-heading m-0 text-xl leading-tight font-normal">Check your email</h2>
      <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
        Pip sent a sign-in link to <strong className="text-ink break-all">{email}</strong>. Open it
        in this browser and you're in.
      </p>
      <button
        type="button"
        onClick={onRestart}
        className="text-solid cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-bold"
      >
        Use a different email
      </button>
    </section>
  );
}
