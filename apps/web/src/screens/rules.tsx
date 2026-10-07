import {
  BUCKET_META,
  displayNameFor,
  type Bucket,
  type BucketRule,
  type RulesView,
} from "@finance-app/shared";
import { TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NotAdviceLabel } from "../components/not-advice-label";
import { ProgressCapBar } from "../components/progress-cap-bar";
import { Skeleton } from "../components/skeleton";
import { formatPercent, formatPounds } from "../lib/format";
import { useRules, useSaveRules, type RuleSettings } from "../lib/rules";
import { ICON_STROKE } from "../shell/nav";
import { TrustRulesSection } from "./trust-rules-section";
import { useBreakpoint } from "../shell/use-breakpoint";

/**
 * The shape you set, and where each pot actually sits against it
 * (DESIGN.md §7). Handpicked's target and Side Bet's cap have steppers
 * (Phase 4); Foundation is the rest. The API checks the limits and judges the
 * shape — this screen only shows its answer — and nothing here may suggest Pip
 * will move money (design rules 1, 8).
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

      <div className="mt-3">
        <TrustRulesSection isDesktop={isDesktop} />
      </div>

      <p className="text-ink3 mx-2 mt-5 text-center text-[11.5px] leading-normal font-medium">
        Changing a rule changes what Pip tells you — it never moves your money.
      </p>
    </div>
  );
}

function RulesLoaded({ view, isDesktop }: { view: RulesView; isDesktop: boolean }) {
  const breached = view.rules.find((rule) => rule.overBy);
  const save = useSaveRules();
  // What the sliders show. Nothing is sent until Save — one call, however far they moved.
  const saved = view.settings;
  const [settings, setSettings] = useState(saved);
  useEffect(() => {
    setSettings(saved);
    // Only when the saved rules themselves change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.handpickedTarget]);
  const unsaved =
    settings !== undefined &&
    saved !== undefined &&
    settings.handpickedTarget !== saved.handpickedTarget;
  const leftOut = view.leftOut ?? [];
  const judged = view.rules.some((rule) => rule.available !== false);

  const change = (next: RuleSettings) => {
    save.reset();
    setSettings(next);
  };

  return (
    <div className="flex flex-col gap-3">
      {breached ? (
        <OverLimitBanner rule={breached} fixIt={view.fixIt} isDesktop={isDesktop} />
      ) : null}

      {judged && leftOut.length > 0 ? (
        <p className="bg-sunk text-ink2 m-0 rounded-[18px] px-4 py-3 text-[12.5px] leading-normal font-medium">
          {listNames(leftOut)} {leftOut.length === 1 ? "isn't" : "aren't"} connected, so your
          targets are judged against the pots Pip can see. Side Bet's limit is in pounds, so it
          doesn't change.
        </p>
      ) : null}

      <p aria-live="polite" className="sr-only">
        {save.isPending ? "Saving your rules…" : save.isSuccess ? "Rules saved." : ""}
      </p>

      <div className={isDesktop ? "grid grid-cols-3 gap-3.5" : "flex flex-col gap-[11px]"}>
        {view.rules.map((rule) => (
          <RuleCard key={rule.bucket} rule={rule} settings={settings} onChange={change} />
        ))}
      </div>

      {unsaved || save.isError ? (
        <section className="bg-card flex flex-wrap items-center gap-3 rounded-[22px] px-[18px] py-3.5">
          <p
            role={save.isError ? "alert" : undefined}
            className={`m-0 flex-1 text-[12.5px] font-semibold ${save.isError ? "text-dn" : "text-ink2"}`}
          >
            {save.isError
              ? "Couldn't save that. Your rules haven't changed — try again."
              : "You've changed your rules. Nothing is saved until you save."}
          </p>
          <button
            type="button"
            disabled={save.isPending || !unsaved}
            onClick={() => settings && save.mutate(settings)}
            className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-4 py-2 text-[13px] font-bold disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save rules"}
          </button>
        </section>
      ) : null}

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
 * do either at your broker (design rules 1, 9).
 */
function OverLimitBanner({
  rule,
  fixIt,
  isDesktop,
}: {
  rule: BucketRule;
  fixIt: RulesView["fixIt"];
  isDesktop: boolean;
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
          {name} has reached {rule.limit?.starter ? "its starter limit" : "its limit"}
        </h2>
        <p className="m-0 mt-1.5 text-[13.5px] leading-normal font-medium">
          You've put in {formatPounds(rule.limit?.moneyIn ?? 0, { whole: true })} over the last
          year, against a limit of {formatPounds(rule.limit?.limit ?? 0, { whole: true })} —{" "}
          {formatPounds(overBy.amount, { whole: true })} more than the FCA's 10% guide allows for.
          Pip can't stop anything; it can only tell you where the line is.
        </p>
        {fixIt ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              aria-expanded={showingFix}
              onClick={() => setShowingFix((open) => !open)}
              className={action}
            >
              Show me how to fix it
            </button>
          </div>
        ) : null}
        {showingFix && fixIt ? <FixItPanel name={name} fixIt={fixIt} /> : null}
        <div className="mt-3 opacity-85">
          <NotAdviceLabel />
        </div>
      </div>
    </section>
  );
}

/**
 * One amount now the limit is in pounds: taking that much out of Side Bet
 * brings money in, less taken out, back under the line. Arithmetic, not advice.
 */
function FixItPanel({ name, fixIt }: { name: string; fixIt: NonNullable<RulesView["fixIt"]> }) {
  return (
    <div
      role="region"
      aria-label="What would bring it back under its limit"
      className="bg-card text-ink mt-3 rounded-[18px] px-4 py-3.5"
    >
      <p className="m-0 text-[12.5px] font-semibold">
        What would bring {name} back under its limit:
      </p>
      <div className="mt-2.5">
        <FixItAmount amount={fixIt.outOfSideBet} words={`taken out of ${name}`} />
      </div>
      <p className="text-ink2 m-0 mt-2.5 text-[12px] leading-normal font-medium">
        Taking money out counts against what you've put in. You'd do that at your broker.
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
  onChange,
}: {
  rule: BucketRule;
  settings: RuleSettings | undefined;
  onChange: (next: RuleSettings) => void;
}) {
  const { scope } = BUCKET_META[rule.bucket];
  const isSideBet = scope === "bet";
  const kind = isSideBet ? "Limit" : "Target";
  // While the slider moves, the numbers follow it before the save lands.
  const line = settings
    ? rule.bucket === "Base"
      ? 100 - settings.handpickedTarget
      : settings.handpickedTarget
    : rule.targetPercent;

  // Foundation is the rest: when a slider changes it, its number briefly lights so the link is visible.
  const [changed, setChanged] = useState(false);
  const previous = useRef(line);
  useEffect(() => {
    if (rule.bucket !== "Base" || previous.current === line) return;
    previous.current = line;
    setChanged(true);
    const timer = setTimeout(() => setChanged(false), 900);
    return () => clearTimeout(timer);
  }, [line, rule.bucket]);

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
      <div className="mt-0.5 mb-3">
        <span
          data-changed={changed || undefined}
          className={`font-heading -mx-1.5 inline-block rounded-[10px] px-1.5 text-[34px] leading-none transition-colors duration-500 ${
            changed ? "bg-tint text-aink" : "bg-transparent"
          }`}
        >
          {isSideBet && rule.limit
            ? formatPounds(rule.limit.limit, { whole: true })
            : formatPercent(line)}
        </span>
      </div>
      {settings && !isSideBet ? (
        <RuleSlider bucket={rule.bucket} settings={settings} onChange={onChange} />
      ) : null}
      {settings && rule.bucket === "Base" ? (
        <p className="text-ink3 m-0 -mt-1.5 mb-3 text-[11.5px] font-semibold">
          The rest, after Handpicked
        </p>
      ) : null}
      {isSideBet && rule.limit ? (
        <p className="text-ink3 m-0 -mt-1.5 mb-3 text-[11.5px] leading-normal font-semibold">
          {rule.limit.starter
            ? "Starter limit — add your net assets in Setup and Pip will use the FCA's 10% guide."
            : "The FCA's 10% guide on the net assets you gave Pip. It only counts Side Bet."}
        </p>
      ) : null}

      {rule.available === false ? (
        <p className="text-ink3 m-0 text-[12.5px] font-semibold">Not connected yet</p>
      ) : isSideBet && rule.limit ? (
        <ProgressCapBar
          label="Money in, less taken out"
          actualPercent={Math.min(rule.limit.usedPercent, 100)}
          targetPercent={100}
          kind="cap"
          over={rule.status === "over_limit"}
          scaleMax={100}
          overByAmount={rule.overBy?.amount}
        />
      ) : (
        <ProgressCapBar
          label="Where it sits"
          actualPercent={rule.actualPercent}
          // A target is judged against its scaled figure when a pot isn't connected; show that line.
          targetPercent={rule.judgedAgainstPercent ?? rule.targetPercent}
          kind="target"
          over={false}
          scaleMax={100}
        />
      )}

      <p className="text-ink2 m-0 mt-2.5 text-[12.5px] leading-normal font-medium">{rule.plain}</p>
    </section>
  );
}

/**
 * A slider for each of the two numbers the user sets — easy on a phone, arrow
 * keys on a keyboard. Foundation has none: it's the rest. Moving one saves
 * nothing; the page's Save button does. The range only stops shapes that can't
 * exist; the API is what enforces the limits.
 */
function RuleSlider({
  bucket,
  settings,
  onChange,
}: {
  bucket: Bucket;
  settings: RuleSettings;
  onChange: (next: RuleSettings) => void;
}) {
  // Foundation is the rest, and Side Bet isn't in the shape at all (Phase 6):
  // Handpicked's target is the only number anyone sets.
  if (bucket !== "Medium") return null;
  const value = settings.handpickedTarget;
  const name = `${displayNameFor(bucket)}'s target`;

  return (
    <div className="mb-3">
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-label={name}
        aria-valuetext={`${value}%`}
        onChange={(event) => onChange({ handpickedTarget: Number(event.target.value) })}
        className="accent-acc h-7 w-full cursor-pointer"
      />
      <div className="text-ink3 flex justify-between text-[11px] font-semibold">
        <span>0%</span>
        <span>100%</span>
      </div>
      <p className="text-ink2 m-0 mt-1.5 text-[11.5px] font-semibold">
        Foundation takes whatever's left.
      </p>
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
