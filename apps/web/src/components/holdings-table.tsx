import type { Change, Holding } from "@finance-app/shared";
import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { changeTone, formatPercent, formatPounds, formatSignedPounds } from "../lib/format";
import { ICON_STROKE } from "../shell/nav";
import { pointerWords } from "../shell/pointer-words";
import type { Breakpoint } from "../shell/use-breakpoint";
import { shadeFor } from "./shades";
import { Sparkline } from "./sparkline";

type SortKey = "name" | "value" | "change";
interface SortState {
  key: SortKey;
  ascending: boolean;
}

/**
 * The full holdings list, sortable. Three columns is the phone's limit, so the
 * plain-English sub-line stands in for a fourth; desktop restores it
 * (Holding · Value · Today · Since you bought) and gives the sparkline its own
 * gutter. That's the ceiling — no weight, no cost basis (DESIGN.md §8).
 *
 * Whole rows are the tap target, not a chevron.
 */
export function HoldingsTable({
  holdings,
  breakpoint,
}: {
  holdings: Holding[];
  breakpoint: Breakpoint;
}) {
  const [sort, setSort] = useState<SortState>({ key: "value", ascending: false });
  const isDesktop = breakpoint === "desktop";
  const words = pointerWords(breakpoint);

  // A holding keeps its shade however the list is sorted, so its colour means
  // the holding, not its current position.
  const shades = useMemo(
    () => new Map(holdings.map((holding, index) => [holding.id, shadeFor(index)])),
    [holdings],
  );

  const sorted = useMemo(() => [...holdings].sort(comparator(sort)), [holdings, sort]);

  const choose = (key: SortKey) =>
    setSort((current) =>
      current.key === key
        ? { key, ascending: !current.ascending }
        : // Names read naturally A–Z; money and change read biggest first.
          { key, ascending: key === "name" },
    );

  return (
    <div>
      <div
        className={`text-ink2 grid gap-3.5 pb-2.5 text-[10.5px] font-bold tracking-[0.07em] uppercase ${
          isDesktop ? "grid-cols-[1fr_92px_120px_170px]" : "grid-cols-[1fr_auto_auto]"
        }`}
      >
        <SortButton label="Holding" sortKey="name" sort={sort} onChoose={choose} />
        <SortButton label="Value" sortKey="value" sort={sort} onChoose={choose} align="end" />
        {isDesktop ? <span className="text-right">Today</span> : null}
        <SortButton
          label={isDesktop ? "Since you bought" : "Change"}
          sortKey="change"
          sort={sort}
          onChoose={choose}
          align="end"
        />
      </div>

      <ul className="m-0 list-none p-0">
        {sorted.map((holding) => (
          <li key={holding.id} className="border-line border-t">
            <Link
              to={`/instruments/${holding.id}`}
              className={`text-ink grid items-center gap-3.5 py-3 no-underline ${
                isDesktop ? "grid-cols-[1fr_92px_120px_170px]" : "grid-cols-[1fr_auto_auto]"
              }`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden
                  className="bg-acc h-2.5 w-2.5 flex-none rounded-full"
                  style={{ opacity: shades.get(holding.id) }}
                />
                <div className="min-w-0">
                  <div
                    className="truncate text-sm leading-tight font-semibold"
                    title={holding.name}
                  >
                    {holding.name}
                  </div>
                  <div className="text-ink3 mt-px truncate text-[11.5px] font-medium">
                    {holding.subtitle}
                  </div>
                </div>
              </div>

              {isDesktop ? (
                <>
                  <div className="text-right text-sm font-bold">{formatPounds(holding.value)}</div>
                  <div className="text-right text-[13px] font-bold">
                    <ChangeText change={holding.today} />
                  </div>
                  <div className="flex items-center justify-end gap-3">
                    <Sparkline series={holding.series} width={56} height={20} strokeWidth={1.75} />
                    <span className="text-[13px] font-bold">
                      <ChangeText change={holding.sinceBought} />
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Sparkline series={holding.series} width={44} height={16} strokeWidth={1.75} />
                  <div className="flex items-center gap-2">
                    <div className="min-w-[62px] text-right">
                      <div className="text-sm font-bold">{formatPounds(holding.value)}</div>
                      <div className="mt-px text-[11.5px] font-semibold">
                        <ChangeText change={holding.sinceBought} />
                      </div>
                    </div>
                    <ChevronRight
                      size={15}
                      strokeWidth={ICON_STROKE}
                      className="text-ink3 flex-none"
                      aria-hidden
                    />
                  </div>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <p className="text-ink3 m-0 mt-3 text-[11.5px] font-semibold">
        {words.Verb} any holding for its own page. {words.Verb} a {isDesktop ? "heading" : "column"}{" "}
        to sort.
      </p>
    </div>
  );
}

function SortButton({
  label,
  sortKey,
  sort,
  onChoose,
  align = "start",
}: {
  label: string;
  sortKey: SortKey;
  sort: SortState;
  onChoose: (key: SortKey) => void;
  align?: "start" | "end";
}) {
  const active = sort.key === sortKey;
  const arrow = active ? (sort.ascending ? " ↑" : " ↓") : "";

  return (
    <button
      type="button"
      onClick={() => onChoose(sortKey)}
      aria-label={`Sort by ${label.toLowerCase()}${active ? (sort.ascending ? ", ascending" : ", descending") : ""}`}
      aria-pressed={active}
      className={`cursor-pointer border-0 bg-transparent p-0 text-[10.5px] font-bold tracking-[0.07em] uppercase ${
        active ? "text-ink" : "text-ink2"
      } ${align === "end" ? "text-right" : "text-left"}`}
    >
      {label}
      {arrow}
    </button>
  );
}

/** Pounds first, then the percentage — never a bare percent (DESIGN.md §4.1). */
function ChangeText({ change }: { change: Change }) {
  return (
    <>
      <span className={changeTone(change)}>{formatSignedPounds(change.amount)}</span>{" "}
      <span className="text-ink3 font-semibold">
        {formatPercent(change.percent, { signed: true })}
      </span>
    </>
  );
}

function comparator({ key, ascending }: SortState) {
  const direction = ascending ? 1 : -1;

  return (a: Holding, b: Holding) => {
    if (key === "name") return a.name.localeCompare(b.name) * direction;
    if (key === "value") return (a.value - b.value) * direction;
    return (a.sinceBought.amount - b.sinceBought.amount) * direction;
  };
}
