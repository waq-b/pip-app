import { House, Milestone, Settings } from "lucide-react";

/**
 * Three destinations, the same at every width (DESIGN.md §7). The labels are
 * the design's, not the route names: "Setup", never "Settings".
 */
export interface NavDestination {
  path: string;
  label: string;
  icon: typeof House;
  /** Pot detail, instrument detail and Your week live under Pots, so it stays lit there. */
  matches: (pathname: string) => boolean;
}

export const NAV: NavDestination[] = [
  {
    path: "/",
    label: "Pots",
    icon: House,
    matches: (pathname) =>
      pathname === "/" ||
      pathname.startsWith("/pots") ||
      pathname.startsWith("/instruments") ||
      pathname.startsWith("/week"),
  },
  {
    path: "/rules",
    label: "Rules",
    icon: Milestone,
    matches: (pathname) => pathname.startsWith("/rules"),
  },
  {
    path: "/setup",
    label: "Setup",
    icon: Settings,
    matches: (pathname) => pathname.startsWith("/setup"),
  },
];

/** Lucide at the weight the whole app uses (DESIGN.md §3). */
export const ICON_STROKE = 2.75;
