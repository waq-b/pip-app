import { BUCKET_META, displayNameFor, type BucketRule, type RulesView } from "@finance-app/shared";
import { TriangleAlert } from "lucide-react";
import { NotAdviceLabel } from "../components/not-advice-label";
import { ProgressCapBar } from "../components/progress-cap-bar";
import { Skeleton } from "../components/skeleton";
import { formatPercent, formatPounds } from "../lib/format";
import { useRules } from "../lib/rules";
import { ICON_STROKE } from "../shell/nav";
import { useBreakpoint } from "../shell/use-breakpoint";

/**
 * The shape you set, and where each pot actually sits against it
 * (DESIGN.md §7). **Display only in Phase 1**: no steppers, no "raise the cap",
 * no "show me how to fix it". Rule editing arrives with the Phase 5 engine, and
 * nothing on this screen may suggest Pip will move money (CLAUDE.md hard line 1).
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

  return (
    <div className="flex flex-col gap-3">
      {breached ? <OverCapBanner rule={breached} isDesktop={isDesktop} /> : null}

      <div className={isDesktop ? "grid grid-cols-3 gap-3.5" : "flex flex-col gap-[11px]"}>
        {view.rules.map((rule) => (
          <RuleCard key={rule.bucket} rule={rule} />
        ))}
      </div>

      <section className="bg-card rounded-[26px] px-[19px] py-[18px]">
        <h2 className="font-heading m-0 mb-1 text-[19px] font-normal">Where your new money goes</h2>
        <p className="text-ink2 m-0 mb-3.5 text-[13px] leading-normal">
          The {formatPounds(view.monthlySplit.total, { whole: true })} a month you pay in, as you've
          set it up at your broker. Pip reads the split — it doesn't make it.
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
      </section>
    </div>
  );
}

/**
 * States the breach and stops. No buttons: fixing it happens at the broker, and
 * changing the cap is Phase 5. Pounds lead, because a percentage alone means
 * nothing (DESIGN.md §4.1).
 */
function OverCapBanner({ rule, isDesktop }: { rule: BucketRule; isDesktop: boolean }) {
  const overBy = rule.overBy!;

  return (
    <section
      role="alert"
      className={`pot-bet bg-tint border-acc text-aink flex items-start gap-3.5 rounded-[26px] border-2 ${isDesktop ? "px-6 py-5" : "p-[18px]"}`}
    >
      <TriangleAlert size={22} strokeWidth={ICON_STROKE} className="mt-px flex-none" aria-hidden />
      <div>
        <h2 className="font-heading m-0 text-[19px] leading-tight font-normal">
          {displayNameFor(rule.bucket)} is {formatPounds(overBy.amount, { whole: true })} over its
          cap
        </h2>
        <p className="m-0 mt-1.5 text-[13.5px] leading-normal font-medium">
          It's grown to {formatPercent(rule.actualPercent)} of your money, against the{" "}
          {formatPercent(rule.targetPercent)} you set —{" "}
          {formatPounds(overBy.amount, { whole: true })} more than you meant to have riding on it.
        </p>
        <div className="mt-3 opacity-85">
          <NotAdviceLabel />
        </div>
      </div>
    </section>
  );
}

function RuleCard({ rule }: { rule: BucketRule }) {
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
      <div className="font-heading mt-0.5 mb-3 text-[34px] leading-none">
        {formatPercent(rule.targetPercent)}
      </div>

      <ProgressCapBar
        label="Where it sits"
        actualPercent={rule.actualPercent}
        targetPercent={rule.targetPercent}
        kind={rule.kind}
        // A 5% cap would be an invisible sliver on a 0–100 track.
        scaleMax={rule.kind === "cap" ? rule.targetPercent * 2 : 100}
        overByAmount={rule.overBy?.amount}
      />

      <p className="text-ink2 m-0 mt-2.5 text-[12.5px] leading-normal font-medium">{rule.plain}</p>
    </section>
  );
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
