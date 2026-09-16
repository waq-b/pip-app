import {
  BUCKET_META,
  SIDE_BET_CAP_MAX,
  SIDE_BET_CAP_NOTE_ABOVE,
  displayNameFor,
  type Bucket,
  type BucketRule,
  type RulesView,
} from "@finance-app/shared";
import { Minus, Plus, TriangleAlert } from "lucide-react";
import { useRef, useState, type RefObject } from "react";
import { NotAdviceLabel } from "../components/not-advice-label";
import { ProgressCapBar } from "../components/progress-cap-bar";
import { Skeleton } from "../components/skeleton";
import { formatPercent, formatPounds } from "../lib/format";
import { useRules, useSaveRules, type RuleSettings } from "../lib/rules";
import { ICON_STROKE } from "../shell/nav";
import { useBreakpoint } from "../shell/use-breakpoint";

/**
 * The shape you set, and where each pot actually sits against it
 * (DESIGN.md §7). Handpicked's target and Side Bet's cap have steppers
 * (Phase 4); Foundation is the rest. The API checks the limits and judges the
 * shape — this screen only shows its answer — and nothing here may suggest Pip
 * will move money (CLAUDE.md hard lines 1, 11).
 */
export function RulesScreen() {
  const isDesktop = useBreakpoint() === "desktop";
  const rules = useRules();

  return (
    <div className={isDesktop ? "" : "px-5 pt-1 pb-6"}>
      <header className="pt-1 pb-4">
        <h1
          className={`font-heading m-0 font-normal tracking-[-0.02em] ${isDesktop ? "text-[32px]" : "text-[29px]"}`}
        >
          Your rules
        </h1>
        <p className="text-ink2 m-0 mt-1.5 text-[13.5px] leading-normal">
          You set the shape once. Pip tells you if the shape drifts.
        </p>
        {rules.data?.lastChangedAt ? (
          <p className="text-ink3 m-0 mt-1 text-[12px] font-semibold">
            Last changed {dayMonth(rules.data.lastChangedAt)}
          </p>
        ) : null}
      </header>

      {rules.isPending ? (
        <RulesLoading />
      ) : rules.isError ? (
        <RulesError onRetry={() => void rules.refetch()} />
      ) : (
        <RulesLoaded view={rules.data} isDesktop={isDesktop} />
      )}

      <p className="text-ink3 mx-2 mt-5 text-center text-[11.5px] leading-normal font-medium">
        Changing a rule changes what Pip tells you — it never moves your money.
      </p>
    </div>
  );
}

function RulesLoaded({ view, isDesktop }: { view: RulesView; isDesktop: boolean }) {
  const breached = view.rules.find((rule) => rule.overBy);
  const save = useSaveRules();
  const settings = view.settings;
  const leftOut = view.leftOut ?? [];
  const judged = view.rules.some((rule) => rule.available !== false);

  const [raisingCap, setRaisingCap] = useState(false);
  const raiseCapButton = useRef<HTMLButtonElement>(null);

  const change = (next: RuleSettings) => {
    if (save.isPending) return;
    save.mutate(next);
  };

  const raiseTheCap = () => {
    setRaisingCap(true);
    raiseCapButton.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    raiseCapButton.current?.focus();
  };

  return (
    <div className="flex flex-col gap-3">
      {breached ? (
        <OverCapBanner
          rule={breached}
          fixIt={view.fixIt}
          isDesktop={isDesktop}
          onRaiseCap={settings ? raiseTheCap : undefined}
        />
      ) : null}

      {judged && leftOut.length > 0 ? (
        <p className="bg-sunk text-ink2 m-0 rounded-[18px] px-4 py-3 text-[12.5px] leading-normal font-medium">
          {listNames(leftOut)} {leftOut.length === 1 ? "isn't" : "aren't"} connected, so your
          targets are judged against the pots Pip can see. Side Bet's cap stays as you set it.
        </p>
      ) : null}

      {save.isError ? (
        <p
          role="alert"
          className="pot-bet bg-tint text-aink m-0 rounded-[18px] px-4 py-3 text-[12.5px] font-semibold"
        >
          Couldn't save that. Your rules haven't changed — try again.
        </p>
      ) : null}

      <div className={isDesktop ? "grid grid-cols-3 gap-3.5" : "flex flex-col gap-[11px]"}>
        {view.rules.map((rule) => (
          <RuleCard
            key={rule.bucket}
            rule={rule}
            settings={settings}
            saving={save.isPending}
            onChange={change}
            raisingCap={raisingCap}
            raiseCapButton={raiseCapButton}
          />
        ))}
      </div>

      <section className="bg-card rounded-[26px] px-[19px] py-[18px]">
        <h2 className="font-heading m-0 mb-1 text-[19px] font-normal">Where your new money goes</h2>
        {view.monthlySplit.comingSoon ? (
          <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
            Coming soon. Pip will read the monthly split you've set up at your broker — it doesn't
            make it.
          </p>
        ) : (
          <>
            <p className="text-ink2 m-0 mb-3.5 text-[13px] leading-normal">
              The {formatPounds(view.monthlySplit.total, { whole: true })} a month you pay in, as
              you've set it up at your broker. Pip reads the split — it doesn't make it.
            </p>
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              {view.monthlySplit.perBucket.map((part) => (
                <li key={part.bucket} className="flex items-center gap-3">
                  <span className="w-[96px] flex-none text-[13.5px] font-semibold">
                    {displayNameFor(part.bucket)}
                  </span>
                  <span className="bg-sunk relative h-2 flex-1 rounded-full" aria-hidden>
                    <span
                      className="absolute inset-y-0 left-0 rounded-full"
                      style={{
                        width: `${part.percent}%`,
                        backgroundColor: `var(--pip-seed-${BUCKET_META[part.bucket].scope})`,
                      }}
                    />
                  </span>
                  <span className="w-[46px] flex-none text-right text-[13.5px] font-bold">
                    {formatPounds(part.amount, { whole: true })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * States the breach in pounds first (DESIGN.md §4.1). "Show me how to fix it"
 * only does the arithmetic — two amounts, equal weight, no preference — and
 * "Raise the cap" only takes you to the stepper. Nothing here moves money; you'd
 * do either at your broker (hard lines 1, 12).
 */
function OverCapBanner({
  rule,
  fixIt,
  isDesktop,
  onRaiseCap,
}: {
  rule: BucketRule;
  fixIt: RulesView["fixIt"];
  isDesktop: boolean;
  onRaiseCap?: () => void;
}) {
  const overBy = rule.overBy!;
  const [showingFix, setShowingFix] = useState(false);
  const name = displayNameFor(rule.bucket);
  const action =
    "border-aink text-aink cursor-pointer rounded-full border-[1.5px] bg-transparent px-3.5 py-2 text-[12.5px] font-bold";

  return (
    <section
      role="alert"
      className={`pot-bet bg-tint border-acc text-aink flex items-start gap-3.5 rounded-[26px] border-2 ${isDesktop ? "px-6 py-5" : "p-[18px]"}`}
    >
      <TriangleAlert size={22} strokeWidth={ICON_STROKE} className="mt-px flex-none" aria-hidden />
      <div className="min-w-0 flex-1">
        <h2 className="font-heading m-0 text-[19px] leading-tight font-normal">
          {name} is {formatPounds(overBy.amount, { whole: true })} over its cap
        </h2>
        <p className="m-0 mt-1.5 text-[13.5px] leading-normal font-medium">
          It's grown to {formatPercent(rule.actualPercent)} of your money, against the{" "}
          {formatPercent(rule.targetPercent)} you set —{" "}
          {formatPounds(overBy.amount, { whole: true })} more than you meant to have riding on it.
        </p>
        {fixIt || onRaiseCap ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {fixIt ? (
              <button
                type="button"
                aria-expanded={showingFix}
                onClick={() => setShowingFix((open) => !open)}
                className={action}
              >
                Show me how to fix it
              </button>
            ) : null}
            {onRaiseCap ? (
              <button type="button" onClick={onRaiseCap} className={action}>
                Raise the cap
              </button>
            ) : null}
          </div>
        ) : null}
        {showingFix && fixIt ? (
          <FixItPanel name={name} cap={rule.targetPercent} fixIt={fixIt} />
        ) : null}
        <div className="mt-3 opacity-85">
          <NotAdviceLabel />
        </div>
      </div>
    </section>
  );
}

/** The two amounts, side by side at the same size. Neither is the answer. */
function FixItPanel({
  name,
  cap,
  fixIt,
}: {
  name: string;
  cap: number;
  fixIt: NonNullable<RulesView["fixIt"]>;
}) {
  return (
    <div
      role="region"
      aria-label="What would bring it back to its cap"
      className="bg-card text-ink mt-3 rounded-[18px] px-4 py-3.5"
    >
      <p className="m-0 text-[12.5px] font-semibold">
        What would bring {name} back to {formatPercent(cap)}:
      </p>
      <div className="mt-2.5 grid grid-cols-2 gap-2.5">
        <FixItAmount amount={fixIt.outOfSideBet} words={`leaving ${name}`} />
        {fixIt.intoOtherPots === null ? (
          <div className="bg-sunk rounded-[14px] px-3 py-2.5 text-[12.5px] font-medium">
            With a 0% cap, no amount added elsewhere would do it.
          </div>
        ) : (
          <FixItAmount amount={fixIt.intoOtherPots} words="going into Foundation or Handpicked" />
        )}
      </div>
      <p className="text-ink2 m-0 mt-2.5 text-[12px] leading-normal font-medium">
        Either one on its own would do it. You'd do either at your broker.
      </p>
    </div>
  );
}

function FixItAmount({ amount, words }: { amount: number; words: string }) {
  return (
    <div className="bg-sunk rounded-[14px] px-3 py-2.5">
      <div className="font-heading text-[22px] leading-none">
        {formatPounds(amount, { whole: true })}
      </div>
      <div className="text-ink2 mt-1 text-[12px] font-medium">{words}</div>
    </div>
  );
}

function RuleCard({
  rule,
  settings,
  saving,
  onChange,
  raisingCap,
  raiseCapButton,
}: {
  rule: BucketRule;
  settings: RuleSettings | undefined;
  saving: boolean;
  onChange: (next: RuleSettings) => void;
  raisingCap: boolean;
  raiseCapButton: RefObject<HTMLButtonElement | null>;
}) {
  const { scope } = BUCKET_META[rule.bucket];
  const isSideBet = scope === "bet";
  const kind = rule.kind === "cap" ? "Hard cap" : "Target";

  return (
    <section
      className={`pot-${scope} bg-card rounded-[26px] border-[1.5px] px-[19px] py-[18px] ${
        isSideBet ? "border-acc hatch" : "border-transparent"
      }`}
    >
      <div className="mb-3 flex items-center gap-2">
        <span aria-hidden className="bg-acc h-[11px] w-[11px] rounded-full" />
        <h2 className="font-heading m-0 text-xl font-normal">{displayNameFor(rule.bucket)}</h2>
        <span className="bg-tint text-aink ml-auto rounded-full px-3 py-1 text-[11px] font-bold">
          {kind}
        </span>
      </div>

      <div className="text-ink2 text-[11.5px] font-semibold tracking-[0.04em] uppercase">
        {kind}
      </div>
      <div className="mt-0.5 mb-3 flex items-center gap-3">
        <div className="font-heading text-[34px] leading-none">
          {formatPercent(rule.targetPercent)}
        </div>
        {settings ? (
          <RuleStepper
            bucket={rule.bucket}
            settings={settings}
            saving={saving}
            onChange={onChange}
            raiseButton={rule.bucket === "Degen" ? raiseCapButton : undefined}
          />
        ) : null}
      </div>
      {settings && rule.bucket === "Base" ? (
        <p className="text-ink3 m-0 -mt-1.5 mb-3 text-[11.5px] font-semibold">
          The rest, after Handpicked and Side Bet
        </p>
      ) : null}
      {settings && rule.bucket === "Degen" && raisingCap ? (
        <p className="text-ink2 m-0 -mt-1.5 mb-3 text-[11.5px] leading-normal font-semibold">
          Raising the cap changes what Pip tells you. It doesn't move any money.
        </p>
      ) : null}
      {settings && rule.bucket === "Degen" && settings.sideBetCap > SIDE_BET_CAP_NOTE_ABOVE ? (
        <p className="text-ink2 m-0 -mt-1.5 mb-3 text-[11.5px] leading-normal font-semibold">
          Above the 10% the FCA restricted-investor rules assume.
        </p>
      ) : null}

      {rule.available === false ? (
        <p className="text-ink3 m-0 text-[12.5px] font-semibold">Not connected yet</p>
      ) : (
        <ProgressCapBar
          label="Where it sits"
          actualPercent={rule.actualPercent}
          // A target is judged against its scaled figure when a pot isn't connected; show that line.
          targetPercent={
            rule.kind === "target"
              ? (rule.judgedAgainstPercent ?? rule.targetPercent)
              : rule.targetPercent
          }
          kind={rule.kind}
          over={rule.status === undefined ? undefined : rule.status === "over_cap"}
          // A 5% cap would be an invisible sliver on a 0–100 track.
          scaleMax={rule.kind === "cap" ? rule.targetPercent * 2 : 100}
          overByAmount={rule.overBy?.amount}
        />
      )}

      <p className="text-ink2 m-0 mt-2.5 text-[12.5px] leading-normal font-medium">{rule.plain}</p>
    </section>
  );
}

/**
 * −/+ for the two numbers the user sets. Foundation has none: it's the rest.
 * Limits here only stop pointless taps; the API is what enforces them.
 */
function RuleStepper({
  bucket,
  settings,
  saving,
  onChange,
  raiseButton,
}: {
  bucket: Bucket;
  settings: RuleSettings;
  saving: boolean;
  onChange: (next: RuleSettings) => void;
  raiseButton?: RefObject<HTMLButtonElement | null>;
}) {
  if (bucket === "Base") return null;
  const isCap = bucket === "Degen";
  const value = isCap ? settings.sideBetCap : settings.handpickedTarget;
  const max = isCap
    ? Math.min(SIDE_BET_CAP_MAX, 100 - settings.handpickedTarget)
    : 100 - settings.sideBetCap;
  const name = `${displayNameFor(bucket)}'s ${isCap ? "cap" : "target"}`;
  const set = (next: number) =>
    onChange(isCap ? { ...settings, sideBetCap: next } : { ...settings, handpickedTarget: next });

  const button =
    "border-line text-ink grid h-9 w-9 cursor-pointer place-items-center rounded-full border-[1.5px] bg-transparent disabled:cursor-default disabled:opacity-40";
  return (
    <div className="ml-auto flex items-center gap-2" aria-busy={saving || undefined}>
      <button
        type="button"
        aria-label={`Lower ${name}`}
        disabled={saving || value <= 0}
        onClick={() => set(value - 1)}
        className={button}
      >
        <Minus size={16} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
      <button
        type="button"
        ref={raiseButton}
        aria-label={`Raise ${name}`}
        disabled={saving || value >= max}
        onClick={() => set(value + 1)}
        className={button}
      >
        <Plus size={16} strokeWidth={ICON_STROKE} aria-hidden />
      </button>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dayMonth(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]}`;
}

function listNames(buckets: Bucket[]): string {
  const names = buckets.map(displayNameFor);
  return names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function RulesLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-[11px]">
      <Skeleton height={112} rounded="rounded-[24px]" />
      <Skeleton height={112} rounded="rounded-[24px]" />
      <Skeleton height={112} rounded="rounded-[24px]" />
    </div>
  );
}

function RulesError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="pot-bet bg-tint border-acc text-aink rounded-[22px] border-2 px-[18px] py-4"
    >
      <h2 className="font-heading m-0 text-[17px] leading-tight font-normal">
        Can't load your rules right now
      </h2>
      <p className="m-0 mt-1.5 text-[12.5px] leading-normal font-medium">
        Nothing has changed — this is only the view of them.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="border-aink text-aink mt-3 cursor-pointer rounded-full border-[1.5px] bg-transparent px-3.5 py-2 text-[12.5px] font-bold"
      >
        Try again
      </button>
    </section>
  );
}
