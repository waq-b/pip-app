import { PROFILE_LIMITS, type Profile } from "@finance-app/shared";
import { X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { Skeleton } from "../components/skeleton";
import { useProfile, useSaveProfile } from "../lib/research-settings";
import { ICON_STROKE } from "../shell/nav";

const same = (a: Profile, b: Profile) => JSON.stringify(a) === JSON.stringify(b);

/** Whole pounds typed → pence, or null for blank. Undefined when it isn't a number. */
function poundsToPence(text: string): number | null | undefined {
  const cleaned = text.replace(/[£,\s]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Math.round(Number(cleaned) * 100);
}

/**
 * Your plan (Phase 5 decision 5), on Setup: what Pip writes your notes for.
 * Nothing is required. Things never to nudge on apply to everyone; the rest
 * only shapes the words for people Waqar has turned personal research on for.
 */
export function YourPlan() {
  const query = useProfile();
  const save = useSaveProfile();
  const saved = query.data?.profile;
  const [draft, setDraft] = useState(saved);
  const [monthly, setMonthly] = useState("");
  const [adding, setAdding] = useState("");
  const ids = {
    goals: useId(),
    horizon: useId(),
    monthly: useId(),
    risk: useId(),
    exclusion: useId(),
  };

  useEffect(() => {
    if (!saved) return;
    setDraft(saved);
    setMonthly(saved.monthlyInPence === null ? "" : String(saved.monthlyInPence / 100));
  }, [saved]);

  const monthlyPence = poundsToPence(monthly);
  const next =
    draft && monthlyPence !== undefined ? { ...draft, monthlyInPence: monthlyPence } : undefined;
  const unsaved = next !== undefined && saved !== undefined && !same(next, saved);
  const change = (value: Profile) => {
    save.reset();
    setDraft(value);
  };

  const addExclusion = () => {
    if (!draft) return;
    const item = adding.trim().slice(0, PROFILE_LIMITS.exclusionMaxLength);
    setAdding("");
    if (!item || draft.exclusions.some((e) => e.toLowerCase() === item.toLowerCase())) return;
    change({ ...draft, exclusions: [...draft.exclusions, item] });
  };

  const field = "bg-sunk border-line w-full rounded-[14px] border px-3.5 py-2.5 text-[13.5px]";
  const labelClass = "text-ink2 mb-1.5 block text-[11px] font-bold tracking-[0.06em] uppercase";

  return (
    <section aria-labelledby="your-plan-heading" className="bg-card rounded-[26px] px-[18px] py-5">
      <h2 id="your-plan-heading" className="font-heading m-0 text-[19px] font-normal">
        Your plan
      </h2>
      <p className="text-ink2 m-0 mt-1 mb-4 text-[12.5px] leading-normal font-medium">
        What Pip keeps in mind when it writes Your week. Nothing here is required.
      </p>

      {query.isPending || !draft ? (
        query.isError ? (
          <p className="text-ink2 m-0 text-[13px] font-medium">
            Couldn't load your plan. It's as you left it.{" "}
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="text-ink cursor-pointer border-0 bg-transparent p-0 font-bold underline"
            >
              Try again
            </button>
          </p>
        ) : (
          <Skeleton height={260} rounded="rounded-[18px]" />
        )
      ) : (
        <div className="flex flex-col gap-3.5">
          {query.data?.personalised === false ? (
            <p className="bg-sunk text-ink2 m-0 rounded-[14px] px-3.5 py-2.5 text-[12.5px] font-medium">
              Pip keeps its notes general for now. The things you never want to hear about still
              apply.
            </p>
          ) : null}

          <div>
            <label htmlFor={ids.goals} className={labelClass}>
              What you're investing for
            </label>
            <textarea
              id={ids.goals}
              rows={2}
              maxLength={PROFILE_LIMITS.textMax}
              value={draft.goals}
              onChange={(event) => change({ ...draft, goals: event.target.value })}
              className={field}
            />
            <Counter value={draft.goals} />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor={ids.horizon} className={labelClass}>
                For how many years
              </label>
              <input
                id={ids.horizon}
                type="number"
                inputMode="numeric"
                min={PROFILE_LIMITS.horizonYears.min}
                max={PROFILE_LIMITS.horizonYears.max}
                value={draft.horizonYears ?? ""}
                onChange={(event) =>
                  change({
                    ...draft,
                    horizonYears:
                      event.target.value === ""
                        ? null
                        : Math.max(
                            0,
                            Math.min(
                              PROFILE_LIMITS.horizonYears.max,
                              Math.round(Number(event.target.value)),
                            ),
                          ),
                  })
                }
                className={field}
              />
            </div>
            <div className="flex-1">
              <label htmlFor={ids.monthly} className={labelClass}>
                Money in each month
              </label>
              <input
                id={ids.monthly}
                inputMode="decimal"
                placeholder="£"
                value={monthly}
                onChange={(event) => {
                  save.reset();
                  setMonthly(event.target.value);
                }}
                className={field}
              />
              {monthlyPence === undefined ? (
                <p className="text-dn m-0 mt-1 text-[12px] font-semibold">
                  Pounds, like 500 or 500.50.
                </p>
              ) : null}
            </div>
          </div>

          <div>
            <label htmlFor={ids.risk} className={labelClass}>
              How you feel about risk, in your words
            </label>
            <textarea
              id={ids.risk}
              rows={2}
              maxLength={PROFILE_LIMITS.textMax}
              value={draft.riskWords}
              onChange={(event) => change({ ...draft, riskWords: event.target.value })}
              className={field}
            />
            <Counter value={draft.riskWords} />
          </div>

          <div>
            <label htmlFor={ids.exclusion} className={labelClass}>
              Never nudge me about
            </label>
            {draft.exclusions.length > 0 ? (
              <ul
                aria-label="Never nudge me about"
                className="m-0 mb-2 flex list-none flex-wrap gap-1.5 p-0"
              >
                {draft.exclusions.map((item) => (
                  <li
                    key={item}
                    className="bg-sunk flex items-center gap-1 rounded-full py-1 pr-1 pl-3 text-[12.5px] font-semibold"
                  >
                    {item}
                    <button
                      type="button"
                      aria-label={`Remove ${item}`}
                      onClick={() =>
                        change({ ...draft, exclusions: draft.exclusions.filter((e) => e !== item) })
                      }
                      className="text-ink2 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent"
                    >
                      <X size={13} strokeWidth={ICON_STROKE} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <input
                id={ids.exclusion}
                placeholder="A holding, a pot or a word"
                value={adding}
                maxLength={PROFILE_LIMITS.exclusionMaxLength}
                disabled={draft.exclusions.length >= PROFILE_LIMITS.exclusionsMax}
                onChange={(event) => setAdding(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addExclusion();
                  }
                }}
                className={`${field} min-w-0 flex-1 rounded-full`}
              />
              <button
                type="button"
                onClick={addExclusion}
                className="border-ink text-ink cursor-pointer rounded-full border-[1.5px] bg-transparent px-3.5 py-2 text-[12.5px] font-bold"
              >
                Add
              </button>
            </div>
          </div>

          {unsaved || save.isError ? (
            <div className="bg-sunk flex flex-wrap items-center gap-3 rounded-[18px] px-4 py-3">
              <p
                role={save.isError ? "alert" : undefined}
                className={`m-0 flex-1 text-[12.5px] font-semibold ${save.isError ? "text-dn" : "text-ink2"}`}
              >
                {save.isError
                  ? "Couldn't save your plan. Nothing's changed — try again."
                  : "Nothing is saved until you save."}
              </p>
              <button
                type="button"
                disabled={save.isPending || !unsaved}
                onClick={() => next && save.mutate(next)}
                className="bg-solid text-solid-ink cursor-pointer rounded-full border-0 px-4 py-2 text-[13px] font-bold disabled:opacity-50"
              >
                {save.isPending ? "Saving…" : "Save plan"}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Counter({ value }: { value: string }) {
  return (
    <div className="text-ink3 mt-1 text-right text-[11px] font-semibold">
      {value.length} / {PROFILE_LIMITS.textMax}
    </div>
  );
}
