import { BUCKET_META, displayNameFor, type NudgeView, type WeekView } from "@finance-app/shared";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { NotAdviceLabel } from "../components/not-advice-label";
import { Skeleton } from "../components/skeleton";
import { ApiError } from "../lib/api";
import { RESPONSES, shortDay, usePastWeek, useRespond, useWeek } from "../lib/week";
import { ICON_STROKE } from "../shell/nav";
import { useBreakpoint } from "../shell/use-breakpoint";

const KIND_WORDS: Record<NudgeView["kind"], string> = {
  none: "Your week",
  shape: "Your shape",
  calendar: "On the calendar",
  awareness: "Worth knowing",
};

/**
 * Your week (Phase 5 decision 7): one card per note, with what it rests on,
 * which trust rules it passed, and what you did about it. A quiet week is a
 * finding with its working. What the trust rules held back is one tap away,
 * so silence is visibly the rules working. Earlier weeks sit underneath.
 */
export function WeekScreen() {
  const { weekOf } = useParams();
  const breakpoint = useBreakpoint();
  const current = useWeek();
  const past = usePastWeek(weekOf);
  const query = weekOf ? past : current;
  const week: WeekView | null | undefined = weekOf ? past.data : current.data?.week;
  const notFound =
    weekOf !== undefined && past.error instanceof ApiError && past.error.status === 404;

  return (
    <div className={`${breakpoint === "phone" ? "px-5 pt-1 pb-6" : "mx-auto max-w-[720px]"}`}>
      <Link
        to={weekOf ? "/week" : "/"}
        className="text-ink2 mb-3.5 flex items-center gap-3 pt-1 text-[13px] font-semibold no-underline"
      >
        <span className="bg-card text-ink grid h-9 w-9 place-items-center rounded-full">
          <ChevronLeft size={18} strokeWidth={ICON_STROKE} aria-hidden />
        </span>
        {weekOf ? "Back to this week" : "Back to your pots"}
      </Link>

      {notFound ? (
        <Plain>
          There's no week from then. Weeks start from the first Monday Pip was reading your
          accounts.
        </Plain>
      ) : query.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <Skeleton height={60} rounded="rounded-[24px]" />
          <Skeleton height={160} rounded="rounded-[26px]" />
          <Skeleton height={160} rounded="rounded-[26px]" />
        </div>
      ) : query.isError ? (
        <section role="alert" className="bg-card rounded-[22px] px-[18px] py-4">
          <h2 className="font-heading m-0 text-[17px] font-normal">
            Can't load your week right now
          </h2>
          <p className="text-ink2 m-0 mt-1.5 text-[12.5px] font-medium">
            Your money is fine — this is only the view of it.
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="border-ink text-ink mt-3 cursor-pointer rounded-full border-[1.5px] bg-transparent px-3.5 py-2 text-[12.5px] font-bold"
          >
            Try again
          </button>
        </section>
      ) : !week ? (
        <>
          <Header title="Your week" sub="Every Monday morning, by 8am" />
          <Plain>
            Your first week arrives on Monday. Pip will look at what you hold, the news from
            publishers you trust, and what's on the calendar — and tell you if anything needs you.
            Most weeks, nothing will.
          </Plain>
          <DailyNotes nudges={current.data?.today ?? []} />
        </>
      ) : (
        <>
          <Header title="Your week" sub={`Week of ${shortDay(week.weekOf)}`} />
          <p className="font-heading m-0 mb-4 text-[22px] leading-tight">{week.opening}</p>
          {!weekOf ? <DailyNotes nudges={current.data?.today ?? []} /> : null}
          <div className="flex flex-col gap-3">
            {week.nudges.map((nudge) => (
              <NudgeCard key={nudge.id} nudge={nudge} />
            ))}
          </div>
          <p className="text-ink2 m-0 py-4 text-center text-[13px] font-medium">
            {week.nudges.some((n) => n.kind === "none")
              ? "That's the lot. Quiet week."
              : "That's the lot."}
          </p>
          <HeldBack nudges={week.heldBack} />
          {!weekOf ? <PastWeeks weeks={current.data?.pastWeeks ?? []} /> : null}
        </>
      )}

      <p className="text-ink3 mt-6 text-center text-xs font-medium">
        Pip can look, not touch. Nothing here can buy or sell anything.
      </p>
    </div>
  );
}

function Header({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="mb-3">
      <h1 className="font-heading m-0 text-[29px] leading-tight font-normal">{title}</h1>
      <div className="text-ink2 mt-0.5 text-[12.5px] font-medium">{sub}</div>
    </div>
  );
}

function Plain({ children }: { children: React.ReactNode }) {
  return (
    <p className="bg-card text-ink2 m-0 rounded-[26px] px-5 py-4 text-[13.5px] leading-normal font-medium">
      {children}
    </p>
  );
}

function DailyNotes({ nudges }: { nudges: NudgeView[] }) {
  if (nudges.length === 0) return null;
  return (
    <section aria-label="Today" className="mb-4">
      <h2 className="text-ink2 m-0 mb-2 text-[11px] font-bold tracking-[0.12em] uppercase">
        Today
      </h2>
      <div className="flex flex-col gap-3">
        {nudges.map((nudge) => (
          <NudgeCard key={nudge.id} nudge={nudge} />
        ))}
      </div>
    </section>
  );
}

export function NudgeCard({ nudge, heldBack = false }: { nudge: NudgeView; heldBack?: boolean }) {
  const scope = nudge.bucket ? `pot-${BUCKET_META[nudge.bucket].scope}` : "";
  const fenced = nudge.bucket === "Degen" ? "hatch border-acc border-2" : "";
  const passed = nudge.checks.filter((check) => check.passed);
  const quiet = nudge.kind === "none";

  return (
    <article className={`${scope} ${fenced} bg-card rounded-[26px] px-[18px] py-4`}>
      <div className="mb-1.5 flex items-center gap-2">
        {nudge.bucket ? (
          <span className="bg-tint text-aink rounded-full px-2.5 py-1 text-[11px] font-bold">
            {displayNameFor(nudge.bucket)}
          </span>
        ) : null}
        <span className="text-ink3 text-[11px] font-bold tracking-[0.08em] uppercase">
          {KIND_WORDS[nudge.kind]}
        </span>
      </div>
      <h3 className="font-heading m-0 text-[19px] leading-snug font-normal">{nudge.title}</h3>
      <p className="text-ink2 m-0 mt-1.5 text-[13.5px] leading-normal font-medium">{nudge.body}</p>

      {nudge.basis ? (
        <p className="text-ink m-0 mt-2.5 text-[12.5px] font-semibold">{nudge.basis}</p>
      ) : null}

      {nudge.sources.length > 0 ? (
        <ul aria-label="Sources" className="m-0 mt-2 flex list-none flex-col gap-1.5 p-0">
          {nudge.sources.slice(0, 5).map((source) => (
            <li key={source.url} className="text-[12.5px] leading-snug">
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink inline-flex items-start gap-1 underline-offset-2"
              >
                <span>
                  <span className="font-semibold">{source.publisher}</span> ·{" "}
                  {shortDay(source.publishedAt.slice(0, 10))} · {source.headline}
                </span>
                <ExternalLink
                  size={12}
                  strokeWidth={ICON_STROKE}
                  aria-hidden
                  className="mt-0.5 flex-none"
                />
              </a>
            </li>
          ))}
          {nudge.sources.length > 5 ? (
            <li className="text-ink3 text-[12px] font-medium">
              and {nudge.sources.length - 5} more
            </li>
          ) : null}
        </ul>
      ) : null}

      {heldBack && nudge.heldBackBecause ? (
        <p className="text-ink2 m-0 mt-2.5 text-[12.5px] font-semibold">
          Held back: {nudge.heldBackBecause}
        </p>
      ) : passed.length > 0 ? (
        <p className="text-ink3 m-0 mt-2.5 text-[12px] font-medium">
          Passed: {passed.map((check) => check.rule).join(" · ")}
        </p>
      ) : null}

      {!quiet ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <NotAdviceLabel />
          {!heldBack ? <WhatYouDid nudge={nudge} /> : null}
        </div>
      ) : null}
    </article>
  );
}

function WhatYouDid({ nudge }: { nudge: NudgeView }) {
  const respond = useRespond();
  const chosen = respond.isPending ? respond.variables?.response : nudge.response;
  return (
    <div role="group" aria-label="What did you do?" className="flex flex-wrap items-center gap-2">
      <span className="text-ink2 text-[12px] font-semibold">What did you do?</span>
      {RESPONSES.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={chosen === option.id}
          disabled={respond.isPending}
          onClick={() => respond.mutate({ id: nudge.id, response: option.id })}
          className={`cursor-pointer rounded-full border-[1.5px] px-3 py-1.5 text-[12px] font-bold ${
            chosen === option.id
              ? "bg-ink text-ground border-ink"
              : "border-line text-ink bg-transparent"
          }`}
        >
          {option.label}
        </button>
      ))}
      {respond.isError ? (
        <span role="alert" className="text-dn text-[12px] font-semibold">
          Didn't save. Try again.
        </span>
      ) : null}
    </div>
  );
}

function HeldBack({ nudges }: { nudges: NudgeView[] }) {
  const [open, setOpen] = useState(false);
  if (nudges.length === 0) return null;
  const count = nudges.length === 1 ? "1 thing" : `${nudges.length} things`;
  return (
    <section className="mt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="text-ink2 w-full cursor-pointer rounded-full border-0 bg-transparent py-2 text-[13px] font-semibold underline underline-offset-2"
      >
        {open ? "Hide what was held back" : `${count} didn't get past your trust rules`}
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-3 opacity-80">
          {nudges.map((nudge) => (
            <NudgeCard key={nudge.id} nudge={nudge} heldBack />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function PastWeeks({ weeks }: { weeks: string[] }) {
  if (weeks.length === 0) return null;
  return (
    <section className="mt-5">
      <h2 className="text-ink2 m-0 mb-2 text-[11px] font-bold tracking-[0.12em] uppercase">
        Earlier weeks
      </h2>
      <ul className="bg-card m-0 list-none rounded-[22px] px-[18px] py-1">
        {weeks.map((weekOf) => (
          <li key={weekOf} className="border-line border-b last:border-b-0">
            <Link
              to={`/week/${weekOf}`}
              className="text-ink block py-3 text-[13.5px] font-semibold no-underline"
            >
              Week of {shortDay(weekOf)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
