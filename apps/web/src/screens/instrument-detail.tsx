import {
  BUCKET_META,
  displayNameFor,
  type InstrumentDetail,
  type PriceRange,
} from "@finance-app/shared";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { BigNumber } from "../components/big-number";
import { LineChart } from "../components/line-chart";
import { NotAdviceLabel } from "../components/not-advice-label";
import { AgeChip, ProvenanceLine } from "../components/provenance";
import { StaleCard } from "../components/stale-card";
import { Skeleton } from "../components/skeleton";
import { ApiError } from "../lib/api";
import { changeTone, formatPercent, formatPounds, formatSignedPounds } from "../lib/format";
import { priceCaption, RANGES, rangeStartLabel, useInstrument } from "../lib/instrument";
import { ladder } from "../lib/staleness";
import { ICON_STROKE } from "../shell/nav";
import { useBreakpoint, type Breakpoint } from "../shell/use-breakpoint";

/**
 * One holding: what it is, what it's worth to you, what its price has done,
 * and what it is in plain English (DESIGN.md §7–8). The explainer is
 * information, not advice, and says so.
 */
export function InstrumentDetailScreen() {
  const { id } = useParams();
  const breakpoint = useBreakpoint();
  const [range, setRange] = useState<PriceRange>("all");
  const instrument = useInstrument(id, range);

  const notFound = instrument.error instanceof ApiError && instrument.error.status === 404;

  return (
    <div className={breakpoint === "phone" ? "px-5 pt-1 pb-6" : ""}>
      {notFound ? (
        <>
          <BackLink to="/" label="Back to your pots" />
          <section className="bg-card rounded-[24px] px-5 py-6">
            <h1 className="font-heading m-0 text-[22px] font-normal">No such holding</h1>
            <p className="text-ink2 m-0 mt-2 text-[13.5px] leading-normal font-medium">
              It isn't in any of your pots.
            </p>
          </section>
        </>
      ) : instrument.isPending ? (
        <InstrumentLoading />
      ) : instrument.isError ? (
        <InstrumentError onRetry={() => void instrument.refetch()} />
      ) : (
        <InstrumentLoaded
          instrument={instrument.data}
          breakpoint={breakpoint}
          range={range}
          onRange={setRange}
          onRetry={() => void instrument.refetch()}
        />
      )}
    </div>
  );
}

function InstrumentLoaded({
  instrument,
  breakpoint,
  range,
  onRange,
  onRetry,
}: {
  instrument: InstrumentDetail;
  breakpoint: Breakpoint;
  range: PriceRange;
  onRange: (range: PriceRange) => void;
  onRetry: () => void;
}) {
  const stale = ladder([{ bucket: instrument.bucket, freshness: instrument.freshness }], {
    single: "Price",
  });
  const ageHours = stale.chipped[instrument.bucket];
  const { scope, provider } = BUCKET_META[instrument.bucket];
  const potName = displayNameFor(instrument.bucket);
  const isDesktop = breakpoint === "desktop";
  const hasHistory = instrument.series.length >= 2;

  const info = (
    <section className="bg-card rounded-[30px] p-[22px]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="bg-tint text-aink flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold">
          <span aria-hidden className="bg-acc h-2 w-2 rounded-full" />
          {potName}
        </span>
        <span className="bg-sunk text-ink2 rounded-full px-3 py-1 text-[11px] font-bold">
          {instrument.ticker}
        </span>
      </div>
      <h1
        className={`font-heading m-0 leading-[1.15] font-normal tracking-[-0.015em] ${isDesktop ? "text-[30px]" : "text-[27px]"}`}
      >
        {instrument.name}
      </h1>
      <div className="text-ink2 mt-1.5 text-[12.5px] font-medium">
        {instrument.quantity} · {formatPounds(instrument.price)} each
      </div>

      <div className="bg-line my-4 h-px" />

      {ageHours !== undefined ? (
        <div className="mb-1.5">
          <AgeChip hours={ageHours} />
        </div>
      ) : null}
      <div className={stale.dimmed.length > 0 ? "opacity-60" : undefined}>
        <BigNumber
          label="What it's worth to you"
          value={instrument.value}
          size={isDesktop ? "desktop" : "phone"}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-6">
        <Movement label="Today" change={instrument.today} />
        <Movement label="Since you bought" change={instrument.sinceBought} />
      </div>

      {isDesktop ? (
        <>
          <div className="bg-line my-4 h-px" />
          <Explainer note={instrument.note} />
        </>
      ) : null}
    </section>
  );

  const pills = (
    <div
      role="radiogroup"
      aria-label="Price range"
      className="bg-sunk flex gap-[5px] rounded-full p-1"
    >
      {RANGES.map((option) => {
        const selected = option.id === range;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onRange(option.id)}
            className={`flex-1 cursor-pointer rounded-full border-0 px-4 py-2 text-[12.5px] font-bold ${
              selected ? "bg-ink text-ground" : "text-ink2 bg-transparent"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  const provenance = <ProvenanceLine state={stale.state} text={stale.line} />;

  const chart = (
    <section
      className={`bg-card p-[18px] ${isDesktop ? "rounded-[30px] px-7 py-[26px]" : "rounded-[26px]"}`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-4">
        <h2 className="font-heading m-0 text-lg font-normal">Price</h2>
        {isDesktop ? <div className="w-[340px]">{pills}</div> : null}
      </div>
      <LineChart
        series={instrument.series}
        from={rangeStartLabel(instrument.series, range)}
        height={isDesktop ? 330 : 120}
        emptyMessage="No history yet — come back tomorrow"
        caption={
          hasHistory
            ? priceCaption(instrument.series, range)
            : "One day is not a trend, so Pip won't draw you one."
        }
      />
      {isDesktop ? null : <div className="mt-3">{pills}</div>}
      <div className="mt-3">{provenance}</div>
    </section>
  );

  return (
    <div className={`pot-${scope}`}>
      {isDesktop ? (
        <nav
          aria-label="Breadcrumb"
          className="text-ink3 mb-3.5 flex items-center gap-2.5 text-[13px] font-semibold"
        >
          <Link to="/" className="text-ink3 no-underline">
            Pots
          </Link>
          <span aria-hidden>›</span>
          <Link to={`/pots/${instrument.bucket}`} className="text-ink3 no-underline">
            {potName}
          </Link>
          <span aria-hidden>›</span>
          <span className="text-ink" aria-current="page">
            {instrument.name}
          </span>
        </nav>
      ) : (
        <BackLink to={`/pots/${instrument.bucket}`} label={`Back to ${potName}`} />
      )}

      {stale.card ? (
        <div className="mb-[11px]">
          <StaleCard {...stale.card} onRetry={onRetry} />
        </div>
      ) : null}

      {isDesktop ? (
        <div className="grid grid-cols-[400px_1fr] items-start gap-3.5">
          {info}
          {chart}
        </div>
      ) : (
        <div className="flex flex-col gap-[11px]">
          {info}
          {chart}
          <section className="bg-card rounded-[26px] p-[18px]">
            <Explainer note={instrument.note} />
          </section>
        </div>
      )}

      <p className="text-ink3 mx-2 mt-5 text-center text-[11.5px] leading-normal font-medium">
        Read-only. To buy or sell, use {provider} — Pip just keeps score.
      </p>
    </div>
  );
}

/** Pounds first, then the percentage (DESIGN.md §4.1). */
function Movement({ label, change }: { label: string; change: InstrumentDetail["today"] }) {
  return (
    <div>
      <div className="text-ink3 text-[11px] font-bold tracking-[0.05em] uppercase">{label}</div>
      <div className={`mt-0.5 text-[15px] font-bold ${changeTone(change)}`}>
        {formatSignedPounds(change.amount)}{" "}
        <span className="font-semibold">· {formatPercent(change.percent, { signed: true })}</span>
      </div>
    </div>
  );
}

/**
 * Hand-written in Phase 1 and supplied by the Phase 6 research module later.
 * Either way it reads like a view on a company, so it is labelled as
 * information, not advice (CLAUDE.md hard line 12).
 */
function Explainer({ note }: { note: string }) {
  return (
    <div>
      <h2 className="font-heading m-0 mb-2 text-lg font-normal">In plain English</h2>
      <p className="m-0 text-[13.5px] leading-relaxed font-medium">{note}</p>
      <div className="mt-3.5">
        <NotAdviceLabel />
      </div>
    </div>
  );
}

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="text-ink2 mb-3.5 flex items-center gap-3 pt-1 text-[13px] font-semibold no-underline"
    >
      <span className="bg-card text-ink grid h-9 w-9 place-items-center rounded-full">
        <ChevronLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
      </span>
      {label}
    </Link>
  );
}

function InstrumentLoading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-[11px]">
      <div className="bg-card flex flex-col gap-2.5 rounded-[24px] p-[18px]">
        <Skeleton width={104} height={20} rounded="rounded-full" />
        <Skeleton width={160} height={24} />
        <Skeleton width={190} height={38} />
        <Skeleton width={150} height={14} />
      </div>
      <div className="bg-card rounded-[24px] p-[18px]">
        <Skeleton width={64} height={15} />
        <div className="mt-3">
          <Skeleton height={86} rounded="rounded-[14px]" />
        </div>
        <div className="mt-3">
          <Skeleton height={34} rounded="rounded-full" />
        </div>
      </div>
    </div>
  );
}

function InstrumentError({ onRetry }: { onRetry: () => void }) {
  return (
    <section
      role="alert"
      className="pot-bet bg-tint border-acc text-aink rounded-[22px] border-2 px-[18px] py-4"
    >
      <h1 className="font-heading m-0 text-[17px] leading-tight font-normal">
        Can't load this holding right now
      </h1>
      <p className="m-0 mt-1.5 text-[12.5px] leading-normal font-medium">
        You still own exactly what you owned — only the view of it is missing.
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
