import {
  BUCKET_META,
  displayNameFor,
  type PortfolioSummary,
  type Timeframe,
} from "@finance-app/shared";
import { useState } from "react";
import { Link } from "react-router";
import { AllocationRing } from "../components/allocation";
import { BigNumber } from "../components/big-number";
import { ProgressCapBar } from "../components/progress-cap-bar";
import { ProvenanceLine } from "../components/provenance";
import { Skeleton } from "../components/skeleton";
import { StaleCard } from "../components/stale-card";
import { isEmptyPortfolio, TIMEFRAMES, targetSentence, usePortfolio } from "../lib/portfolio";
import { ladder } from "../lib/staleness";
import { PipMark } from "../shell/pip-mark";
import { useBreakpoint, type Breakpoint } from "../shell/use-breakpoint";
import { WeekCard } from "./week-card";
import { useAskNetAssets } from "../lib/net-assets";
import { NetAssetsAsk } from "./net-assets";
import { PotCard, PotRow } from "./pot-card";

/**
 * Pots, the home screen: everything you own as one number, the three pots, how
 * they split against the shape you asked for, and what changed (DESIGN.md §7–8).
 *
 * The provenance line names where prices came from. Whether it reads green,
 * amber or red is the staleness ladder's decision (`lib/staleness.ts`), not
 * this screen's: it only places the line, the chips, the dimming and the card.
 */
export function PotsScreen() {
  const breakpoint = useBreakpoint();
  const [timeframe, setTimeframe] = useState<Timeframe>("day");
  const portfolio = usePortfolio(timeframe);
  const askNetAssets = useAskNetAssets(
    portfolio.data !== undefined && !isEmptyPortfolio(portfolio.data),
  );

  return (
    <div className={breakpoint === "phone" ? "px-5 pt-1 pb-6" : ""}>
      <h1 className="sr-only">Your pots</h1>

      {/* Asked at the end of the first look, never before Pip has shown anything. */}
      {askNetAssets.show ? (
        <div className="mb-3">
          <NetAssetsAsk onDone={askNetAssets.dismiss} />
        </div>
      ) : null}

      {portfolio.isPending ? (
        <PotsLoading />
      ) : portfolio.isError ? (
        <PotsError onRetry={() => void portfolio.refetch()} />
      ) : isEmptyPortfolio(portfolio.data) ? (
        <PotsEmpty />
      ) : (
        <PotsLoaded
          portfolio={portfolio.data}
          breakpoint={breakpoint}
          timeframe={timeframe}
          onTimeframe={setTimeframe}
          onRetry={() => void portfolio.refetch()}
        />
      )}

      <p className="text-ink3 mx-2 mt-5 text-center text-[11.5px] leading-normal font-medium">
        Pip can look, not touch. Nothing in here can buy or sell anything.
      </p>
    </div>
  );
}

function PotsLoaded({
  portfolio,
  breakpoint,
  timeframe,
  onTimeframe,
  onRetry,
}: {
  portfolio: PortfolioSummary;
  breakpoint: Breakpoint;
  timeframe: Timeframe;
  onTimeframe: (timeframe: Timeframe) => void;
  onRetry: () => void;
}) {
  const { label, words } = TIMEFRAMES.find((entry) => entry.id === timeframe)!;
  const stale = ladder(portfolio.freshness);
  const provenance = <ProvenanceLine state={stale.state} text={stale.line} />;
  const card = stale.card ? <StaleCard {...stale.card} onRetry={onRetry} /> : null;
  const everyPotDimmed = stale.dimmed.length === portfolio.buckets.length;
  // Amber never touches the total. Red dims it only when every pot's feed is
  // gone; otherwise it says the total is rough and dims the pots that are.
  const roughly =
    stale.dimmed.length > 0 && !everyPotDimmed ? (
      <div className="text-ink2 mt-1.5 text-[12.5px] font-semibold">
        Roughly — {stale.dimmed.length === 1 ? "one pot is" : "two pots are"} stale
      </div>
    ) : null;
  const potProps = (bucket: PortfolioSummary["buckets"][number]["bucket"]) => ({
    ageHours: stale.chipped[bucket],
    dimmed: stale.dimmed.includes(bucket),
  });
  const totalClass = everyPotDimmed ? "opacity-60" : undefined;
  const noHistory = portfolio.changeUnavailable ? (
    <div className="text-ink2 mt-1.5 text-[12.5px] font-semibold">
      Not enough history yet to say how you did {words}.
    </div>
  ) : null;
  const foundation = portfolio.buckets.find((bucket) => bucket.bucket === "Base");

  const ring = (
    <AllocationRing
      slices={portfolio.buckets.map((bucket) => ({
        bucket: bucket.bucket,
        percent: bucket.shareOfTotal,
        amount: bucket.value,
      }))}
      targetSentence={targetSentence(portfolio.buckets)}
      centre={
        foundation
          ? { value: `${Math.round(foundation.shareOfTotal)}%`, caption: "SAFE MONEY" }
          : undefined
      }
    />
  );

  const pills = <TimeframePills value={timeframe} onChange={onTimeframe} />;

  if (breakpoint === "desktop") {
    return (
      <div className="flex flex-col gap-3.5">
        {card}
        <div className="flex items-end justify-between gap-5">
          <div>
            <div className="text-ink2 text-[11.5px] font-bold tracking-[0.11em] uppercase">
              {label}
            </div>
            <p className="font-heading m-0 mt-1.5 text-[30px] leading-tight tracking-[-0.015em]">
              {portfolio.verdict}
            </p>
          </div>
          <div className="w-[380px] flex-none">{pills}</div>
        </div>

        <section className="bg-card grid grid-cols-[1fr_340px] items-center gap-10 rounded-[30px] px-[30px] py-7">
          <div>
            <div className={totalClass}>
              <BigNumber
                label="Everything you own"
                value={portfolio.total}
                change={portfolio.changeUnavailable ? undefined : portfolio.change}
                when={words}
                size="desktop"
              />
            </div>
            {roughly}
            {noHistory}
            <div className="mt-4">{provenance}</div>
          </div>
          <div className="border-line border-l pl-9">{ring}</div>
        </section>

        <div className="grid grid-cols-3 gap-3.5">
          {portfolio.buckets.map((pot) => (
            <PotCard
              key={pot.bucket}
              pot={pot}
              when={words}
              size="desktop"
              {...potProps(pot.bucket)}
            />
          ))}
        </div>

        <div className="grid grid-cols-[1.55fr_1fr] items-start gap-3.5">
          <WeekCard />
          <section className="bg-card rounded-[26px] px-[22px] py-5">
            <h2 className="font-heading m-0 text-xl font-normal">The shape you asked for</h2>
            <p className="text-ink2 mt-1 mb-4 text-[12.5px] font-medium">
              Set once in Rules. Pip only tells you when the real thing drifts from it.
            </p>
            <div className="flex flex-col gap-4">
              {portfolio.buckets.map((pot) => (
                <div key={pot.bucket} className={`pot-${BUCKET_META[pot.bucket].scope}`}>
                  <ProgressCapBar
                    label={displayNameFor(pot.bucket)}
                    actualPercent={pot.shareOfTotal}
                    targetPercent={pot.targetPercent}
                    kind={BUCKET_META[pot.bucket].scope === "bet" ? "cap" : "target"}
                    over={
                      pot.ruleStatus === undefined ? undefined : pot.ruleStatus === "over_limit"
                    }
                    // A 5% cap would be an invisible sliver on a 0–100 track.
                    scaleMax={BUCKET_META[pot.bucket].scope === "bet" ? 10 : 100}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {card ? <div className="mb-3">{card}</div> : null}
      <section className="bg-card flex flex-col gap-4 rounded-[30px] px-[22px] pt-6 pb-[22px]">
        <div className="text-ink2 text-[11px] font-semibold tracking-[0.11em] uppercase">
          {label}
        </div>
        <p className="font-heading m-0 text-[28px] leading-[1.18] tracking-[-0.015em]">
          {portfolio.verdict}
        </p>
        <div className="bg-line h-px" />
        <div className={totalClass}>
          <BigNumber
            label="Everything you own"
            value={portfolio.total}
            change={portfolio.changeUnavailable ? undefined : portfolio.change}
            when={words}
          />
        </div>
        {roughly}
        {noHistory}
      </section>

      <div className="mx-0.5 mt-3">{provenance}</div>
      <div className="my-3.5">{pills}</div>

      <div className="flex flex-col gap-[11px]">
        {portfolio.buckets.map((pot) =>
          breakpoint === "tablet" ? (
            <PotRow key={pot.bucket} pot={pot} when={words} {...potProps(pot.bucket)} />
          ) : (
            <PotCard key={pot.bucket} pot={pot} when={words} {...potProps(pot.bucket)} />
          ),
        )}
      </div>

      <section className="bg-card mt-[11px] rounded-[26px] p-[19px]">
        <h2 className="font-heading m-0 mb-1 text-[19px] font-normal">How it splits</h2>
        <p className="text-ink2 mt-0 mb-3.5 text-[12.5px] font-medium">
          Where your money actually sits, against the shape you asked for.
        </p>
        {ring}
      </section>

      <div className="mt-6">
        <WeekCard />
      </div>
    </div>
  );
}

function TimeframePills({
  value,
  onChange,
}: {
  value: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Timeframe"
      className="bg-sunk flex gap-[5px] rounded-full p-1"
    >
      {TIMEFRAMES.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.id)}
            className={`flex-1 cursor-pointer rounded-full border-0 py-[9px] text-[13px] font-bold ${
              selected ? "bg-ink text-ground" : "text-ink2 bg-transparent"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Loading shows the numbers' shape, never a spinner where a number will be. */
function PotsLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-[11px]">
      <div className="bg-card flex flex-col gap-3 rounded-[24px] p-[18px]">
        <Skeleton width={72} height={10} />
        <Skeleton height={20} />
        <Skeleton width="64%" height={20} />
        <Skeleton width={104} height={11} />
        <Skeleton width={180} height={42} />
        <Skeleton width={130} height={13} />
      </div>
      <Skeleton height={74} rounded="rounded-[22px]" />
      <Skeleton height={74} rounded="rounded-[22px]" />
      <p className="text-ink2 m-0 mt-2 text-center text-xs font-semibold">Counting your money…</p>
    </div>
  );
}

function PotsEmpty() {
  return (
    <section className="bg-card flex flex-col items-start gap-3.5 rounded-[24px] px-5 py-[26px]">
      <PipMark size={54} outline />
      <h2 className="font-heading m-0 text-[23px] leading-[1.22] font-normal">
        Three empty pots,
        <br />
        waiting for you.
      </h2>
      <p className="text-ink2 m-0 text-[13.5px] leading-normal font-medium">
        Hook up one account and Pip will fill all of this in. Takes about a minute, and it can only
        ever look.
      </p>
      <Link
        to="/setup"
        className="bg-solid text-solid-ink rounded-full px-5 py-3 text-sm font-bold no-underline"
      >
        Connect an account
      </Link>
    </section>
  );
}

function PotsError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="pot-bet bg-tint border-acc text-aink rounded-[22px] border-2 px-[18px] py-4"
    >
      <h2 className="font-heading m-0 text-[17px] leading-tight font-normal">
        Can't load your pots right now
      </h2>
      <p className="m-0 mt-1.5 text-[12.5px] leading-normal font-medium">
        Your money is fine — this is only the view of it.
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
