import {
  BUCKETS,
  BUCKET_META,
  displayNameFor,
  TRUST_LIMITS,
  type TrustSettings,
} from "@finance-app/shared";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { Skeleton } from "../components/skeleton";
import { publisherDomain, useSaveTrustRules, useTrustRules } from "../lib/research-settings";
import { ICON_STROKE } from "../shell/nav";

const same = (a: TrustSettings, b: TrustSettings) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What Pip lets through (Phase 5 decision 3), under the rule cards on Rules.
 * The trust rules decide which news and notes reach Your week. Like the
 * shape, nothing is sent until Save, and the API checks every limit. They
 * change what Pip tells you — never your money.
 */
export function TrustRulesSection({ isDesktop }: { isDesktop: boolean }) {
  const query = useTrustRules();
  const save = useSaveTrustRules();
  const saved = query.data?.settings;
  const [settings, setSettings] = useState(saved);
  const [adding, setAdding] = useState("");
  const [addError, setAddError] = useState("");

  useEffect(() => {
    if (saved) setSettings(saved);
  }, [saved]);

  const unsaved = settings !== undefined && saved !== undefined && !same(settings, saved);
  const change = (next: TrustSettings) => {
    save.reset();
    setSettings(next);
  };

  const addPublisher = () => {
    if (!settings) return;
    const domain = publisherDomain(adding);
    if (!domain) {
      setAddError("That doesn't look like a website address, like reuters.com.");
      return;
    }
    setAddError("");
    setAdding("");
    if (!settings.namedPublishers.includes(domain)) {
      change({ ...settings, namedPublishers: [...settings.namedPublishers, domain] });
    }
  };

  return (
    <section
      aria-labelledby="trust-rules-heading"
      className="bg-card rounded-[26px] px-[19px] py-[18px]"
    >
      <h2 id="trust-rules-heading" className="font-heading m-0 mb-1 text-[19px] font-normal">
        What Pip lets through
      </h2>
      <p className="text-ink2 m-0 mb-4 text-[13px] leading-normal">
        These decide which news and notes reach Your week. They change what Pip tells you — never
        your money.
      </p>

      {query.isPending || !settings ? (
        query.isError ? (
          <p className="text-ink2 m-0 text-[13px] font-medium">
            Couldn't load your trust rules. They're as you left them.{" "}
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="text-ink cursor-pointer border-0 bg-transparent p-0 font-bold underline"
            >
              Try again
            </button>
          </p>
        ) : (
          <Skeleton height={220} rounded="rounded-[18px]" />
        )
      ) : (
        <>
          <div className={isDesktop ? "grid grid-cols-2 gap-x-6" : ""}>
            <Slider
              label="How recent news must be"
              words={`The last ${settings.recencyDays} ${settings.recencyDays === 1 ? "day" : "days"}`}
              value={settings.recencyDays}
              limits={TRUST_LIMITS.recencyDays}
              onChange={(recencyDays) => change({ ...settings, recencyDays })}
            />
            <Slider
              label="Different publishers needed"
              words={`At least ${settings.minSources}`}
              value={settings.minSources}
              limits={TRUST_LIMITS.minSources}
              onChange={(minSources) => change({ ...settings, minSources })}
            />
            <Slider
              label="Quiet around a company's results"
              words={
                settings.resultsQuietDays === 0
                  ? "No quiet days"
                  : `${settings.resultsQuietDays} ${settings.resultsQuietDays === 1 ? "day" : "days"} either side`
              }
              value={settings.resultsQuietDays}
              limits={TRUST_LIMITS.resultsQuietDays}
              onChange={(resultsQuietDays) => change({ ...settings, resultsQuietDays })}
            />
            <Slider
              label="News and big-move notes a week"
              words={`Up to ${settings.weeklyBudget}`}
              value={settings.weeklyBudget}
              limits={TRUST_LIMITS.weeklyBudget}
              onChange={(weeklyBudget) => change({ ...settings, weeklyBudget })}
            />
            <Slider
              label="Daily notes a day"
              words={`Up to ${settings.dailyBudgetPerDay}`}
              value={settings.dailyBudgetPerDay}
              limits={TRUST_LIMITS.dailyBudgetPerDay}
              onChange={(dailyBudgetPerDay) => change({ ...settings, dailyBudgetPerDay })}
            />
            <Slider
              label="Daily notes a week"
              words={`Up to ${settings.dailyBudgetPerWeek}`}
              value={settings.dailyBudgetPerWeek}
              limits={TRUST_LIMITS.dailyBudgetPerWeek}
              onChange={(dailyBudgetPerWeek) => change({ ...settings, dailyBudgetPerWeek })}
            />
            {BUCKETS.map((bucket) => (
              <div key={bucket} className={`pot-${BUCKET_META[bucket].scope}`}>
                <Slider
                  label={`A big one-day move in ${displayNameFor(bucket)}`}
                  words={`${settings.bigMovePercent[bucket]}% or more`}
                  value={settings.bigMovePercent[bucket]}
                  limits={TRUST_LIMITS.bigMovePercent}
                  unit="%"
                  onChange={(value) =>
                    change({
                      ...settings,
                      bigMovePercent: { ...settings.bigMovePercent, [bucket]: value },
                    })
                  }
                />
              </div>
            ))}
          </div>

          <div className="mt-1">
            <div className="text-[13.5px] font-semibold">Publishers that count</div>
            <p className="text-ink2 m-0 mt-0.5 mb-2.5 text-[12px] font-medium">
              Reports from anywhere else are ignored. A company's own newsroom always counts for
              news about that company.
            </p>
            <ul
              aria-label="Publishers that count"
              className="m-0 mb-2.5 flex list-none flex-wrap gap-1.5 p-0"
            >
              {settings.namedPublishers.map((domain) => (
                <li
                  key={domain}
                  className="bg-sunk flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-[12.5px] font-semibold"
                >
                  {domain}
                  <button
                    type="button"
                    aria-label={`Remove ${domain}`}
                    disabled={settings.namedPublishers.length <= TRUST_LIMITS.namedPublishers.min}
                    onClick={() =>
                      change({
                        ...settings,
                        namedPublishers: settings.namedPublishers.filter((d) => d !== domain),
                      })
                    }
                    className="text-ink2 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent disabled:opacity-40"
                  >
                    <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                addPublisher();
              }}
            >
              <input
                aria-label="Add a publisher"
                placeholder="e.g. economist.com"
                value={adding}
                onChange={(event) => setAdding(event.target.value)}
                disabled={settings.namedPublishers.length >= TRUST_LIMITS.namedPublishers.max}
                className="bg-sunk border-line min-w-0 flex-1 rounded-full border px-3.5 py-2 text-[13px]"
              />
              <button
                type="submit"
                className="border-ink text-ink cursor-pointer rounded-full border-[1.5px] bg-transparent px-3.5 py-2 text-[12.5px] font-bold"
              >
                Add
              </button>
            </form>
            {addError ? (
              <p className="text-dn m-0 mt-1.5 text-[12px] font-semibold">{addError}</p>
            ) : null}
          </div>

          <p className="text-ink3 m-0 mt-4 text-[12px] font-medium">
            Always on: nothing about a Side Bet holding while Side Bet is over its cap.
          </p>

          {unsaved || save.isError ? (
            <div className="bg-sunk mt-3 flex flex-wrap items-center gap-3 rounded-[18px] px-4 py-3">
              <p
                role={save.isError ? "alert" : undefined}
                className={`m-0 flex-1 text-[12.5px] font-semibold ${save.isError ? "text-dn" : "text-ink2"}`}
              >
                {save.isError
                  ? "Couldn't save that. Your trust rules haven't changed — try again."
                  : "You've changed what Pip lets through. Nothing is saved until you save."}
              </p>
              <button
                type="button"
                disabled={save.isPending || !unsaved}
                onClick={() => save.mutate(settings)}
                className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-4 py-2 text-[13px] font-bold disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save trust rules"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function Slider({
  label,
  words,
  value,
  limits,
  unit = "",
  onChange,
}: {
  label: string;
  words: string;
  value: number;
  limits: { min: number; max: number };
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="mb-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13.5px] font-semibold">{label}</span>
        <span className="text-ink2 text-[12.5px] font-bold">{words}</span>
      </div>
      <input
        type="range"
        min={limits.min}
        max={limits.max}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={words}
        onChange={(event) => onChange(Number(event.target.value))}
        className="accent-acc h-7 w-full cursor-pointer"
      />
      <div className="text-ink3 flex justify-between text-[11px] font-semibold">
        <span>
          {limits.min}
          {unit}
        </span>
        <span>
          {limits.max}
          {unit}
        </span>
      </div>
    </div>
  );
}
