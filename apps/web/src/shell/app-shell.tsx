import { BUCKET_META, BUCKETS, displayNameFor } from "@finance-app/shared";
import { Fragment, type ReactNode } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { ICON_STROKE, NAV, type NavDestination } from "./nav";
import { PipMark } from "./pip-mark";
import { useBreakpoint } from "./use-breakpoint";

export interface AppShellProps {
  /**
   * The one red thing in the app: a dot on Rules when a cap is breached. The
   * Rules screen supplies it once that task wires the data.
   */
  rulesNeedAttention?: boolean;
  /** From the session, once sign-in is built. */
  userName?: string;
  /** The bell (Phase 6), handed in so the chrome itself holds no data. */
  bell?: ReactNode;
}

type IsActive = (destination: NavDestination) => boolean;

/**
 * The chrome around every signed-in screen. Three layouts, one set of
 * destinations (DESIGN.md §8):
 *
 * - under 768: tab bar along the bottom
 * - 768+: a 76px icon rail on the left, content capped at 640
 * - 1120+: the rail becomes a 232px labelled sidebar, content capped at 1080
 *
 * The sidebar rather than a top nav is deliberate: a horizontal band above the
 * content would cost the hero number its place as the first thing you see.
 *
 * Active state comes from each destination's own `matches`, not from route
 * matching: pot detail and instrument detail live under Pots, so Pots stays lit
 * while you're inside one.
 */
export function AppShell({ rulesNeedAttention = false, userName, bell }: AppShellProps) {
  const breakpoint = useBreakpoint();
  const { pathname } = useLocation();
  const isActive: IsActive = (destination) => destination.matches(pathname);

  if (breakpoint === "phone") {
    return (
      <div className="bg-ground text-ink flex min-h-svh flex-col">
        {bell ? (
          <header className="flex items-center justify-between px-5 pt-3">
            <PipMark size={26} />
            {bell}
          </header>
        ) : null}
        <div className="flex-1 pb-2">
          <Outlet />
        </div>
        <TabBar isActive={isActive} rulesNeedAttention={rulesNeedAttention} />
      </div>
    );
  }

  const isDesktop = breakpoint === "desktop";

  return (
    <div className="bg-ground text-ink flex min-h-svh">
      {isDesktop ? (
        <Sidebar
          isActive={isActive}
          pathname={pathname}
          rulesNeedAttention={rulesNeedAttention}
          userName={userName}
        />
      ) : (
        <Rail isActive={isActive} rulesNeedAttention={rulesNeedAttention} bell={bell} />
      )}
      <div className="flex min-w-0 flex-1 justify-center">
        {/* Either side is plain ground — no widgets, no filler. */}
        <div className={`w-full ${isDesktop ? "max-w-[1080px]" : "max-w-[640px]"} px-6 py-8`}>
          {isDesktop && bell ? <div className="-mt-3 mb-1 flex justify-end">{bell}</div> : null}
          <Outlet />
        </div>
      </div>
    </div>
  );
}

function TabBar({
  isActive,
  rulesNeedAttention,
}: {
  isActive: IsActive;
  rulesNeedAttention: boolean;
}) {
  return (
    <nav
      aria-label="Sections"
      className="bg-card border-line sticky bottom-0 flex justify-between border-t px-6 pt-2.5 pb-6"
    >
      {NAV.map((destination) => {
        const active = isActive(destination);

        return (
          <Link
            key={destination.path}
            to={destination.path}
            aria-current={active ? "page" : undefined}
            className="relative flex flex-col items-center gap-1.5 px-4 py-1"
          >
            <destination.icon
              size={23}
              strokeWidth={ICON_STROKE}
              className={active ? "text-ink" : "text-ink3"}
              aria-hidden
            />
            <span className={`text-[10.5px] font-bold ${active ? "text-ink" : "text-ink3"}`}>
              {destination.label}
            </span>
            {destination.label === "Rules" && rulesNeedAttention ? <AlertDot /> : null}
          </Link>
        );
      })}
    </nav>
  );
}

function Rail({
  isActive,
  rulesNeedAttention,
  bell,
}: {
  isActive: IsActive;
  rulesNeedAttention: boolean;
  bell?: ReactNode;
}) {
  return (
    <nav
      aria-label="Sections"
      className="bg-card border-line flex w-[76px] flex-none flex-col items-center gap-4 border-r py-5"
    >
      <PipMark size={26} />
      {NAV.map((destination) => {
        const active = isActive(destination);

        return (
          <Link
            key={destination.path}
            to={destination.path}
            aria-current={active ? "page" : undefined}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={`relative grid h-12 w-12 place-items-center rounded-[18px] ${
                active ? "bg-sunk text-ink" : "text-ink3"
              }`}
            >
              <destination.icon size={21} strokeWidth={ICON_STROKE} aria-hidden />
              {destination.label === "Rules" && rulesNeedAttention ? <AlertDot /> : null}
            </span>
            <span className={`text-[10px] font-bold ${active ? "text-ink" : "text-ink3"}`}>
              {destination.label}
            </span>
          </Link>
        );
      })}
      {/* The bell at the rail's foot (undesigned, DESIGN §9). */}
      {bell ? <div className="mt-auto">{bell}</div> : null}
    </nav>
  );
}

function Sidebar({
  isActive,
  pathname,
  rulesNeedAttention,
  userName,
}: {
  isActive: IsActive;
  pathname: string;
  rulesNeedAttention: boolean;
  userName?: string;
}) {
  const insideAPot = pathname.startsWith("/pots/");

  return (
    <div className="bg-card border-line flex w-[232px] flex-none flex-col gap-6 border-r px-4 pt-6 pb-5">
      <div className="flex items-center gap-2.5 px-2.5">
        <PipMark size={27} />
        <span className="font-heading text-[22px] tracking-tight">Pip</span>
      </div>

      <nav aria-label="Sections" className="flex flex-col gap-1">
        {NAV.map((destination) => {
          const active = isActive(destination);

          return (
            <Fragment key={destination.path}>
              <Link
                to={destination.path}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-full px-3.5 py-2.5 text-[14.5px] ${
                  active ? "bg-sunk text-ink font-bold" : "text-ink3 font-semibold"
                }`}
              >
                <destination.icon size={20} strokeWidth={ICON_STROKE} aria-hidden />
                {destination.label}
                {destination.label === "Rules" && rulesNeedAttention ? (
                  <AlertDot className="ml-auto" />
                ) : null}
              </Link>

              {/* Inside a pot, the other two are one click away (DESIGN.md §8). */}
              {destination.path === "/" && insideAPot ? (
                <div className="flex flex-col gap-0.5 py-0.5 pl-[26px]">
                  {BUCKETS.map((bucket) => {
                    const current = pathname === `/pots/${bucket}`;
                    return (
                      <Link
                        key={bucket}
                        to={`/pots/${bucket}`}
                        aria-current={current ? "page" : undefined}
                        className={`pot-${BUCKET_META[bucket].scope} rounded-full px-3 py-1.5 text-[13px] no-underline ${
                          current ? "bg-tint text-ink font-bold" : "text-ink3 font-semibold"
                        }`}
                      >
                        {displayNameFor(bucket)}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        {/* The read-only promise is chrome on desktop, not just a footer line. */}
        <div className="bg-sunk flex items-center gap-2.5 rounded-[20px] px-3 py-2.5">
          {userName ? (
            <span className="bg-acc text-solid-ink font-heading grid h-8 w-8 flex-none place-items-center rounded-full text-sm">
              {userName.slice(0, 1).toUpperCase()}
            </span>
          ) : null}
          <div className="min-w-0">
            {userName ? <div className="truncate text-[13px] font-bold">{userName}</div> : null}
            <div className="text-ink3 text-[11px] font-semibold">Read-only access</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Side Bet over its cap is the only thing that turns anything red. */
function AlertDot({ className = "absolute top-0.5 right-2.5" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="A rule needs a look"
      className={`bg-alert h-2.5 w-2.5 rounded-full ${className}`}
    />
  );
}
