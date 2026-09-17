import { SIDE_BET_STARTER_LIMIT_PENCE } from "@finance-app/shared";
import { Eye, EyeOff, Lock } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { formatPounds } from "../lib/format";
import {
  useNetAssets,
  useRevealNetAssets,
  useSaveNetAssets,
  type NetAssetsRevealed,
} from "../lib/net-assets";
import { ICON_STROKE } from "../shell/nav";

/**
 * Net assets (DESIGN §11). The single most sensitive number in the app and the
 * one you need to see least often, so it's entered behind dots and stays behind
 * dots — and so is the limit it sets, which would give it away ten times over.
 *
 * Pip uses it for one thing: Side Bet's limit, the FCA's 10% guide. It never
 * goes to a broker, never appears on the home screen, and Pip can't act on it —
 * it can only say where the line is (hard line 1).
 */

const STEP_POUNDS = 5_000;
const DOTS = "••••••";

/** Digits only, so a pasted "£64,000" still works. */
const digitsOf = (value: string) => value.replace(/\D/g, "").slice(0, 10);
const withCommas = (digits: string) => (digits ? Number(digits).toLocaleString("en-GB") : "");

function NetAssetsField({
  pounds,
  onChange,
  shown,
  onToggleShown,
  autoFocus,
}: {
  pounds: string;
  onChange: (digits: string) => void;
  shown: boolean;
  onToggleShown: () => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  const step = (by: number) => {
    const next = Math.max(0, (Number(pounds || "0") || 0) + by);
    onChange(String(next));
  };

  return (
    <div className="bg-sunk rounded-[20px] px-3.5 py-3">
      <label
        htmlFor={id}
        className="text-ink2 mb-1.5 block text-[11px] font-bold tracking-[0.1em] uppercase"
      >
        Net assets
      </label>
      <div className="flex items-center gap-1.5">
        <span className="font-heading text-[22px] leading-none">£</span>
        <input
          id={id}
          type={shown ? "text" : "password"}
          inputMode="numeric"
          autoComplete="off"
          autoFocus={autoFocus}
          value={shown ? withCommas(pounds) : pounds}
          onChange={(event) => onChange(digitsOf(event.target.value))}
          placeholder="0"
          aria-label="Net assets in pounds"
          className="font-heading text-ink min-w-0 flex-1 border-0 bg-transparent p-0 text-[22px] leading-none outline-none"
        />
        <button
          type="button"
          onClick={onToggleShown}
          aria-label={shown ? "Hide net assets" : "Show net assets"}
          aria-pressed={shown}
          className="text-ink2 -my-2.5 -mr-2.5 grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent"
        >
          {shown ? (
            <EyeOff size={20} strokeWidth={ICON_STROKE} aria-hidden />
          ) : (
            <Eye size={20} strokeWidth={ICON_STROKE} aria-hidden />
          )}
        </button>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => step(-STEP_POUNDS)}
          aria-label={`Down ${formatPounds(STEP_POUNDS * 100, { whole: true })}`}
          className="border-line bg-ground text-ink h-11 w-[46px] cursor-pointer rounded-full border-[1.5px] text-[15px] font-extrabold"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => step(STEP_POUNDS)}
          aria-label={`Up ${formatPounds(STEP_POUNDS * 100, { whole: true })}`}
          className="border-line bg-ground text-ink h-11 w-[46px] cursor-pointer rounded-full border-[1.5px] text-[15px] font-extrabold"
        >
          +
        </button>
        <span className="text-ink3 text-[11.5px] font-medium">
          £5,000 steps · nearest thousand is fine
        </span>
      </div>
    </div>
  );
}

/** The limit the figure buys, in Side Bet's colours. Masked with the figure. */
function LimitCard({ limitPence, shown }: { limitPence: number; shown: boolean }) {
  return (
    <div className="pot-bet bg-tint text-aink flex flex-col gap-[7px] rounded-[20px] p-3.5">
      <div className="text-[11px] font-bold tracking-[0.1em] uppercase">Your Side Bet limit</div>
      <div className="font-heading text-[27px] leading-none">
        {shown ? formatPounds(limitPence, { whole: true }) : DOTS}
      </div>
      <div className="text-[12px] leading-normal font-medium opacity-[0.86]">
        10% of what you entered — the FCA's guide for high-risk investments. Pip counts money in,
        less what you've taken out, over 12 months against it.
      </div>
    </div>
  );
}

/**
 * First login, step 2 of 2 (DESIGN §11.2). Asked at the end, never the start:
 * nobody types their net worth into an app that hasn't shown them anything yet.
 */
export function NetAssetsAsk({ onDone }: { onDone: () => void }) {
  const save = useSaveNetAssets();
  const [pounds, setPounds] = useState("");
  const [shown, setShown] = useState(true);
  const entered = Number(pounds || "0") || 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (entered <= 0) return;
    save.mutate(entered, { onSuccess: onDone });
  };

  return (
    <section
      aria-label="Your net assets"
      className="bg-card flex flex-col gap-3.5 rounded-[30px] px-[18px] py-5"
    >
      <div className="text-ink3 text-[11px] font-bold tracking-[0.12em] uppercase">
        First login · step 2 of 2
      </div>
      <Lock size={26} strokeWidth={ICON_STROKE} className="text-acc" aria-hidden />
      <h2 className="font-heading m-0 text-[24px] leading-[1.2] font-normal tracking-[-0.01em]">
        Roughly, what are you worth all in?
      </h2>
      <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
        Pip uses this for one thing: Side Bet's limit. The FCA's guide for high-risk investments is
        no more than 10% of your net assets — home, pension, savings, the lot.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <NetAssetsField
          pounds={pounds}
          onChange={setPounds}
          shown={shown}
          onToggleShown={() => setShown((open) => !open)}
          autoFocus
        />
        {entered > 0 ? <LimitCard limitPence={Math.round(entered * 10)} shown={shown} /> : null}
        <button
          type="submit"
          disabled={entered <= 0 || save.isPending}
          className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-[18px] py-3.5 text-left text-[14.5px] font-bold disabled:cursor-default disabled:opacity-45"
        >
          {save.isPending ? "Saving…" : "Save and show me my money"}
        </button>
      </form>
      {save.isError ? (
        <p role="alert" className="text-ink2 m-0 text-[12.5px] leading-normal font-medium">
          Pip couldn't save that. Give it a moment and try again.
        </p>
      ) : null}
      <button
        type="button"
        onClick={onDone}
        className="text-solid cursor-pointer border-0 bg-transparent p-0 text-left text-[13.5px] font-bold"
      >
        I'd rather not say
      </button>
      <p className="text-ink3 m-0 text-[11.5px] leading-normal font-medium">
        Skip it and Pip uses a {formatPounds(SIDE_BET_STARTER_LIMIT_PENCE, { whole: true })} starter
        limit until you fill it in. Nothing is ever sent to your brokers, and this figure never
        appears on the home screen.
      </p>
    </section>
  );
}

/** The Setup row: set, not set, and the eye (DESIGN §11.3). */
export function NetAssets() {
  const { data, isPending } = useNetAssets();
  const reveal = useRevealNetAssets();
  const save = useSaveNetAssets();
  const [editing, setEditing] = useState(false);
  const [pounds, setPounds] = useState("");
  const [shown, setShown] = useState(false);

  const revealed: NetAssetsRevealed | undefined = reveal.data;
  const show = () => {
    if (shown) {
      setShown(false);
      reveal.reset();
      return;
    }
    reveal.mutate(undefined, { onSuccess: () => setShown(true) });
  };

  const startEditing = () => {
    reveal.mutate(undefined, {
      onSuccess: (current) => {
        setPounds(current.pounds ? String(current.pounds) : "");
        setShown(true);
        setEditing(true);
      },
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const entered = Number(pounds || "0") || 0;
    if (entered <= 0) return;
    save.mutate(entered, {
      onSuccess: () => {
        setEditing(false);
        setShown(false);
        reveal.reset();
      },
    });
  };

  if (isPending || !data) {
    return (
      <section aria-busy="true" className="bg-card rounded-[24px] px-[18px] py-5">
        <div data-skeleton className="bg-skel h-5 w-40 rounded-full" />
      </section>
    );
  }

  return (
    <section aria-label="Net assets" className="bg-card rounded-[24px] px-[18px] py-5">
      <div className="mb-2.5 flex items-center gap-2">
        <Lock
          size={18}
          strokeWidth={ICON_STROKE}
          className={data.set ? "text-ink2" : "text-amber"}
          aria-hidden
        />
        <h2 className="m-0 text-[13.5px] font-bold">Net assets</h2>
        {data.set ? (
          <button
            type="button"
            onClick={startEditing}
            className="text-solid ml-auto cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-bold"
          >
            Change
          </button>
        ) : (
          <span className="bg-amber-tint text-amber ml-auto rounded-full px-2 py-[3px] text-[10px] font-extrabold tracking-[0.04em]">
            NOT SET
          </span>
        )}
      </div>

      {editing ? (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <NetAssetsField
            pounds={pounds}
            onChange={setPounds}
            shown={shown}
            onToggleShown={() => setShown((open) => !open)}
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={save.isPending}
              className="bg-solid text-solid-ink flex-1 cursor-pointer rounded-full border-0 px-4 py-3 text-[13.5px] font-bold disabled:opacity-45"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setShown(false);
                reveal.reset();
              }}
              className="text-ink2 cursor-pointer border-0 bg-transparent px-2 text-[13.5px] font-bold"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : data.set ? (
        <>
          <div className="bg-sunk flex items-center gap-2 rounded-2xl px-3.5 py-3">
            <span className="font-heading text-[19px] leading-none">£</span>
            <span className="font-heading text-ink2 flex-1 text-[19px] leading-none tracking-[0.22em]">
              {shown && revealed?.pounds !== undefined
                ? revealed.pounds.toLocaleString("en-GB")
                : DOTS}
            </span>
            <button
              type="button"
              onClick={show}
              aria-label={shown ? "Hide net assets" : "Show net assets"}
              aria-pressed={shown}
              className="text-ink3 -my-2.5 -mr-2.5 grid h-11 w-11 flex-none cursor-pointer place-items-center rounded-full border-0 bg-transparent"
            >
              {shown ? (
                <EyeOff size={18} strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <Eye size={18} strokeWidth={ICON_STROKE} aria-hidden />
              )}
            </button>
          </div>
          <p className="text-ink3 m-0 mt-2 text-[11.5px] leading-normal font-medium">
            Hidden by default, like a password.
            {data.reviewedAt ? ` Last reviewed ${reviewedWords(data.reviewedAt)}` : ""} — Pip will
            ask you to check it once a year.
          </p>
          {data.dueReview ? (
            <p className="text-amber m-0 mt-1.5 text-[12px] leading-normal font-semibold">
              It's been a year. Worth checking it still looks right.
            </p>
          ) : null}
          {shown && revealed ? (
            <div className="mt-3">
              <WhatItSets limitPence={revealed.limit} starter={revealed.starterLimit} />
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="text-ink2 m-0 mb-3 text-[12.5px] leading-normal font-medium">
            Until Pip knows the bigger number it holds Side Bet to a flat{" "}
            <strong className="text-ink">
              {formatPounds(SIDE_BET_STARTER_LIMIT_PENCE, { whole: true })}
            </strong>{" "}
            limit.
          </p>
          <button
            type="button"
            onClick={() => {
              setPounds("");
              setShown(true);
              setEditing(true);
            }}
            className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-[18px] py-3 text-[13.5px] font-bold"
          >
            Add my net assets
          </button>
        </>
      )}

      <p className="text-ink3 m-0 mt-3 text-[11.5px] leading-normal font-medium">
        Pip can't stop a purchase — it tells you where the line is. It only counts Side Bet, not
        high-risk investments you hold elsewhere.
      </p>
    </section>
  );
}

/** What the figure buys, shown only while the eye is open. */
function WhatItSets({ limitPence, starter }: { limitPence: number; starter: boolean }) {
  return (
    <div className="bg-sunk rounded-2xl px-3.5 py-3">
      <div className="text-ink2 mb-1.5 text-[11px] font-bold tracking-[0.06em] uppercase">
        What it sets
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-ink2 flex-1 text-[13px] font-semibold">
          {starter ? "Starter limit" : "Side Bet limit · 10% of net assets"}
        </span>
        <span className="font-heading text-[17px]">
          {formatPounds(limitPence, { whole: true })}
        </span>
      </div>
    </div>
  );
}

function reviewedWords(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
