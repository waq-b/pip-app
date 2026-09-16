import {
  BUCKET_META,
  displayNameFor,
  type Bucket,
  type BucketDetail,
  type BucketScope,
} from "@finance-app/shared";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { StackedBar } from "../components/allocation";
import { BarChart } from "../components/bar-chart";
import { BigNumber } from "../components/big-number";
import { HoldingsTable } from "../components/holdings-table";
import { LineChart } from "../components/line-chart";
import { AgeChip, ProvenanceLine } from "../components/provenance";
import { StaleCard } from "../components/stale-card";
import { Skeleton } from "../components/skeleton";
import { ApiError } from "../lib/api";
import { parseBucket, useBucketDetail } from "../lib/pot";
import { ladder } from "../lib/staleness";
import { ICON_STROKE } from "../shell/nav";
import { useBreakpoint, type Breakpoint } from "../shell/use-breakpoint";

/** The pill on each pot's header card (DESIGN.md §7). Display copy, so it lives with the screen. */
const BADGE: Record<BucketScope, string> = {
  fnd: "Autopilot",
  pick: "Yours",
  bet: "Capped",
};

/**
 * One pot: what it's worth, how it's gone, what went in, and what's inside
 * (DESIGN.md §7–8). Side Bet stays fenced here too. The footer names the
 * provider, because buying and selling happens there, never here.
 */
export function PotDetailScreen() {
  const params = useParams();
  const bucket = parseBucket(params.bucket);
  const breakpoint = useBreakpoint();
  const detail = useBucketDetail(bucket);

  const notFound =
    bucket === undefined || (detail.error instanceof ApiError && detail.error.status === 404);

  return (
    <div className={breakpoint === "phone" ? "px-5 pt-1 pb-6" : ""}>
      <Link
        to="/"
        className="text-ink2 mb-3.5 flex items-center gap-3 pt-1 text-[13px] font-semibold no-underline"
      >
        <span className="bg-card text-ink grid h-9 w-9 place-items-center rounded-full">
          <ChevronLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
        Back to your pots
      </Link>

      {notFound ? (
        <NotFound />
      ) : detail.isPending ? (
        <PotLoading />
      ) : detail.isError ? (
        <PotError onRetry={() => void detail.refetch()} />
      ) : (
        <PotLoaded
          detail={detail.data}
          breakpoint={breakpoint}
          onRetry={() => void detail.refetch()}
        />
      )}

      {bucket && !notFound ? (
        <p className="text-ink3 mx-2 mt-5 text-center text-[11.5px] leading-normal font-medium">
          Read-only. To buy or sell, use {BUCKET_META[bucket].provider} — Pip just keeps score.
        </p>
      ) : null}
    </div>
  );
}

function PotLoaded({
  detail,
  breakpoint,
  onRetry,
}: {
  detail: BucketDetail;
  breakpoint: Breakpoint;
  onRetry: () => void;
}) {
  const { scope } = BUCKET_META[detail.bucket];
  const isSideBet = scope === "bet";
  const isEmpty = detail.value === 0 && detail.holdings.length === 0;

  if (detail.status === "not_connected") return <PotNotConnected bucket={detail.bucket} />;
  if (isEmpty) return <PotEmpty bucket={detail.bucket} syncing={detail.status === "syncing"} />;

  const stale = ladder([{ bucket: detail.bucket, freshness: detail.freshness }], {
    single: "Prices",
  });
  const provenance = <ProvenanceLine state={stale.state} text={stale.line} />;
  const ageHours = stale.chipped[detail.bucket];
  const isDesktop = breakpoint === "desktop";

  const header = (
    <section
      className={`bg-card rounded-[30px] border-[1.5px] p-[22px] ${
        isSideBet ? "border-acc hatch" : "border-transparent"
      } ${isDesktop ? "grid grid-cols-2 items-center gap-10 px-[30px] py-7" : ""}`}
    >
      <div>
        <div className="mb-2 flex items-center gap-2.5">
          <span aria-hidden className="bg-acc h-[13px] w-[13px] rounded-full" />
          <h1
            className={`font-heading m-0 font-normal tracking-[-0.015em] ${isDesktop ? "text-[27px]" : "text-[26px]"}`}
          >
            {displayNameFor(detail.bucket)}
          </h1>
          <span
            className={`bg-tint text-aink rounded-full px-3 py-1 text-[11px] font-bold ${isDesktop ? "" : "ml-auto"}`}
          >
            {BADGE[scope]}
          </span>
        </div>
        {isDesktop ? null : (
          <p className="text-ink2 m-0 mb-4 text-[13px] leading-normal">{detail.blurb}</p>
        )}
        {ageHours !== undefined ? (
          <div className="mb-1.5">
            <AgeChip hours={ageHours} />
          </div>
        ) : null}
        <div className={stale.dimmed.length > 0 ? "opacity-60" : undefined}>
          <BigNumber
            label="What it's worth"
            value={detail.value}
            change={detail.changeUnavailable ? undefined : detail.change}
            when="today"
            size={isDesktop ? "desktop" : "phone"}
          />
          {detail.changeUnavailable ? (
            <div className="text-ink2 mt-1.5 text-[12.5px] font-semibold">
              Not enough history yet to say how this pot did.
            </div>
          ) : null}
        </div>
      </div>
      {isDesktop ? (
        <div className="border-line border-l pl-9">
          <p className="m-0 text-sm leading-relaxed font-medium">{detail.blurb}</p>
          <p className="text-ink2 m-0 mt-2.5 text-[13.5px] leading-relaxed">{detail.plain}</p>
          <div className="mt-4">{provenance}</div>
        </div>
      ) : (
        <>
          <div className="bg-line my-4 h-px" />
          <p className="m-0 text-[13.5px] leading-normal font-medium">{detail.plain}</p>
        </>
      )}
    </section>
  );

  const hasHistory = detail.chart.series.length >= 2;
  // Stub sample data has no status; real accounts always do.
  const isRealAccount = detail.status !== undefined;
  const chart = (
    <Card
      title="How it's gone"
      aside={hasHistory && detail.chart.from ? `Since ${detail.chart.from}` : undefined}
    >
      <LineChart
        series={detail.chart.series}
        from={detail.chart.from}
        height={isDesktop ? 150 : 120}
        // A real account with no past days yet isn't a failure: history starts now.
        emptyMessage={isRealAccount ? "History starts today — come back tomorrow" : undefined}
        caption={
          hasHistory
            ? detail.chart.caption
            : isRealAccount
              ? "Pip saves this pot's value at every close, and rebuilds earlier days from your order history where it can."
              : "The value above is correct — it's only the history that's missing. Nothing's wrong with your money."
        }
        footer={isDesktop ? undefined : provenance}
      />
    </Card>
  );

  const moneyIn = (
    <Card title="Money in" aside={detail.moneyIn.comingSoon ? undefined : "Last 6 months"}>
      {detail.moneyIn.comingSoon ? (
        <p className="text-ink2 m-0 text-[13px] leading-normal font-medium">
          Coming soon. Once Pip reads your account history, what you paid in each month will show up
          here.
        </p>
      ) : (
        <BarChart bars={detail.moneyIn.months} caption={detail.moneyIn.caption} />
      )}
    </Card>
  );

  const inside = (
    <Card title="What's inside" aside={`${detail.holdings.length} holdings`}>
      <div className="mb-4">
        <StackedBar
          segments={detail.holdings.map((holding) => ({
            id: holding.id,
            label: holding.name,
            percent: holding.shareOfBucket,
          }))}
        />
      </div>
      <HoldingsTable holdings={detail.holdings} breakpoint={breakpoint} />
    </Card>
  );

  return (
    <div className={`pot-${scope} flex flex-col gap-[11px]`}>
      {stale.card ? <StaleCard {...stale.card} onRetry={onRetry} /> : null}
      {header}
      {isDesktop ? (
        <div className="grid grid-cols-[0.8fr_1.45fr] items-start gap-3.5">
          <div className="flex flex-col gap-3.5">
            {chart}
            {moneyIn}
          </div>
          {inside}
        </div>
      ) : (
        <>
          {chart}
          {moneyIn}
          {inside}
        </>
      )}
    </div>
  );
}

function Card({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="bg-card rounded-[26px] p-[18px]">
      <div className="mb-2.5 flex items-baseline justify-between">
        <h2 className="font-heading m-0 text-lg font-normal">{title}</h2>
        {aside ? <span className="text-ink2 text-[11.5px] font-semibold">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * No account feeds this pot yet. Side Bet waits for Kraken (Phase 3); the
 * others point to Setup. Never shows sample money in its place.
 */
function PotNotConnected({ bucket }: { bucket: Bucket }) {
  const { scope, provider } = BUCKET_META[bucket];
  const isSideBet = scope === "bet";

  return (
    <section
      className={`pot-${scope} bg-card rounded-[24px] border-[1.5px] px-[18px] py-[22px] ${
        isSideBet ? "border-acc hatch" : "border-transparent"
      }`}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span aria-hidden className="bg-acc h-3 w-3 rounded-full" />
        <h1 className="font-heading m-0 text-[22px] font-normal">{displayNameFor(bucket)}</h1>
      </div>
      <p className="font-heading m-0 text-[21px] leading-tight">Not connected yet</p>
      <p className="text-ink2 m-0 mt-2.5 text-[13.5px] leading-normal font-medium">
        {isSideBet
          ? "Side Bet arrives in a later update. When Kraken is connected, it'll show here — capped and fenced off like always. Nothing is counted in the meantime."
          : `Connect your ${provider} account and Pip will fill this pot in.`}
      </p>
      {isSideBet ? null : (
        <Link
          to="/setup"
          className="bg-solid text-solid-ink mt-4 inline-block rounded-full px-[18px] py-[11px] text-[13.5px] font-bold no-underline"
        >
          Connect {provider}
        </Link>
      )}
    </section>
  );
}

function PotEmpty({ bucket, syncing = false }: { bucket: Bucket; syncing?: boolean }) {
  const { scope, provider } = BUCKET_META[bucket];
  const isSideBet = scope === "bet";

  return (
    <section
      className={`pot-${scope} bg-card rounded-[24px] border-[1.5px] px-[18px] py-[22px] ${
        isSideBet ? "border-acc hatch" : "border-transparent"
      }`}
    >
      <div className="mb-3.5 flex items-center gap-2.5">
        <span aria-hidden className="bg-acc h-3 w-3 rounded-full" />
        <h1 className="font-heading m-0 text-[22px] font-normal">{displayNameFor(bucket)}</h1>
      </div>
      <div className="font-heading text-[40px] leading-none tracking-[-0.025em]">£0</div>
      <p className="text-ink2 m-0 mt-3 text-[13.5px] leading-normal font-medium">
        {syncing
          ? "Pip is reading your account for the first time. Your holdings will appear here in a moment."
          : isSideBet
            ? "Nothing in here, which is a perfectly good place to leave it. If you do want a flutter, you've set yourself a cap, and Pip will tell you the day it creeps over."
            : "Nothing in here yet. Connect the account that feeds this pot and Pip will fill it in."}
      </p>
      <Link
        to="/setup"
        className="bg-solid text-solid-ink mt-4 inline-block rounded-full px-[18px] py-[11px] text-[13.5px] font-bold no-underline"
      >
        Connect {provider}
      </Link>
      {isSideBet ? (
        <p className="text-ink3 m-0 mt-3.5 text-[11.5px] leading-normal font-medium">
          You don't need this pot. It's just allowed to exist.
        </p>
      ) : null}
    </section>
  );
}

function PotLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-[11px]">
      <div className="bg-card flex flex-col gap-2.5 rounded-[24px] p-[18px]">
        <Skeleton width={120} height={20} />
        <Skeleton width={200} height={36} />
        <Skeleton width={120} height={13} />
      </div>
      <div className="bg-card rounded-[24px] p-[18px]">
        <Skeleton width={110} height={15} />
        <div className="mt-3">
          <Skeleton height={96} rounded="rounded-[14px]" />
        </div>
      </div>
      <div className="bg-card flex flex-col gap-3 rounded-[24px] p-[18px]">
        <Skeleton width={96} height={15} />
        <Skeleton height={11} rounded="rounded-full" />
        <Skeleton width="80%" height={13} />
        <Skeleton width="64%" height={13} />
      </div>
    </div>
  );
}

function PotError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="pot-bet bg-tint border-acc text-aink rounded-[22px] border-2 px-[18px] py-4"
    >
      <h1 className="font-heading m-0 text-[17px] leading-tight font-normal">
        Can't load this pot right now
      </h1>
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

function NotFound() {
  return (
    <section className="bg-card rounded-[24px] px-5 py-6">
      <h1 className="font-heading m-0 text-[22px] font-normal">No such pot</h1>
      <p className="text-ink2 m-0 mt-2 text-[13.5px] leading-normal font-medium">
        Pip has three pots: Foundation, Handpicked and Side Bet.
      </p>
    </section>
  );
}
