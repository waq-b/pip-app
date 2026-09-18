import { useQueryClient } from "@tanstack/react-query";
import { Bell, BellOff, Share } from "lucide-react";
import { useState } from "react";
import { SwitchRow } from "../components/switch";
import {
  baseState,
  currentEnvironment,
  turnOnThisDevice,
  useSaveNotificationSettings,
} from "../lib/push";
import { ICON_STROKE } from "../shell/nav";

/**
 * First login, step 1 of 2: the ask (DESIGN §10.2). Pip asks first, in its own
 * words; the phone's prompt only fires from the primary button with Push
 * alerts on. "Not now" is a real answer and the sheet never comes back —
 * a device can still be turned on from Setup later.
 */

type Step = "ask" | "install" | "quiet";

function primaryLabel(push: boolean, email: boolean): string {
  if (push && email) return "Turn these on";
  if (email) return "Turn on email only";
  if (push) return "Turn on alerts only";
  return "Save";
}

export function NotificationsAsk({
  vapidPublicKey,
  onDone,
}: {
  vapidPublicKey: string | null;
  onDone: () => void;
}) {
  const save = useSaveNotificationSettings();
  const client = useQueryClient();
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(true);
  const [step, setStep] = useState<Step>("ask");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    // The phone's prompt first, straight from the tap: Safari won't show it
    // once anything else has been awaited.
    const env = currentEnvironment();
    const blocker = baseState(env, vapidPublicKey);
    const asking = push && blocker === null ? turnOnThisDevice(vapidPublicKey!) : null;
    try {
      await save.mutateAsync({ push, email, answered: true });
      await asking?.catch(() => undefined);
      await client.invalidateQueries({ queryKey: ["this-device"] });
    } catch {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (push && blocker === "needs_install") setStep("install");
    else onDone();
  };

  const notNow = async () => {
    setBusy(true);
    try {
      await save.mutateAsync({ push: false, email: false, answered: true });
      setStep("quiet");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-ink/28 fixed inset-0 z-40 flex items-end justify-center">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Notifications"
        className="bg-card flex w-full max-w-[460px] flex-col gap-3.5 rounded-t-[28px] rounded-b-[26px] px-5 pt-6 pb-5 shadow-[0_-14px_40px_color-mix(in_srgb,var(--pip-ink)_18%,transparent)]"
      >
        {step === "ask" ? (
          <>
            <div className="text-ink3 text-[11px] font-bold tracking-[0.12em] uppercase">
              First login · step 1 of 2
            </div>
            <Bell size={26} strokeWidth={ICON_STROKE} className="text-acc" aria-hidden />
            <h2 className="font-heading m-0 text-[24px] leading-[1.2] font-normal tracking-[-0.01em]">
              Want Pip to tell you when something matters?
            </h2>
            <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
              Most weeks it won't. Pip only speaks up when something you set a line for is crossed.
            </p>
            <SwitchRow
              label="Push alerts"
              detail="When Side Bet nears its limit, or something can't wait for your week."
              checked={push}
              onChange={setPush}
            />
            <SwitchRow
              label="Weekly email"
              detail="Monday morning: one number, three pots, what moved."
              checked={email}
              onChange={setEmail}
            />
            {save.isError ? (
              <p role="alert" className="text-ink2 m-0 text-[12.5px] font-semibold">
                Couldn't save that. Nothing has changed — try again.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy}
              className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-[18px] py-3.5 text-left text-[14.5px] font-bold disabled:cursor-default disabled:opacity-45"
            >
              {primaryLabel(push, email)}
            </button>
            <button
              type="button"
              onClick={() => void notNow()}
              disabled={busy}
              className="text-ink2 cursor-pointer self-start border-0 bg-transparent p-0 text-[13.5px] font-bold"
            >
              Not now
            </button>
            <p className="text-ink3 m-0 text-[11px] font-medium">
              Both live in the bell afterwards.
            </p>
          </>
        ) : step === "install" ? (
          <>
            <Share size={26} strokeWidth={ICON_STROKE} className="text-acc" aria-hidden />
            <h2 className="font-heading m-0 text-[22px] leading-[1.2] font-normal">
              One more step on this {/iPad/.test(navigator.userAgent) ? "iPad" : "iPhone"}
            </h2>
            <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
              <InstallSteps />
            </p>
            <p className="text-ink3 m-0 text-[11px] font-medium">
              {email
                ? "Your weekly email doesn't need this — it's on."
                : "You can turn it on later in Setup."}
            </p>
            <DoneButton onDone={onDone} />
          </>
        ) : (
          <>
            <BellOff size={26} strokeWidth={ICON_STROKE} className="text-ink2" aria-hidden />
            <h2 className="font-heading m-0 text-[22px] leading-[1.2] font-normal">
              Fine. Pip will stay quiet.
            </h2>
            <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
              Nothing is pushed and no email goes out. The bell still keeps the list.
            </p>
            <span className="bg-sunk text-ink2 self-start rounded-full px-3 py-1.5 text-[11.5px] font-bold">
              Notifications off · the bell still works
            </span>
            <DoneButton onDone={onDone} />
          </>
        )}
      </section>
    </div>
  );
}

/** The one sentence iPhone and iPad need (phase-6.md decision 5). No button: Safari can't ask. */
export function InstallSteps() {
  return (
    <>
      On iPhone and iPad, add Pip to your Home Screen first: tap Share, then Add to Home Screen,
      then open Pip from there.
    </>
  );
}

function DoneButton({ onDone }: { onDone: () => void }) {
  return (
    <button
      type="button"
      onClick={onDone}
      className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-[18px] py-3.5 text-left text-[14.5px] font-bold"
    >
      Done
    </button>
  );
}
