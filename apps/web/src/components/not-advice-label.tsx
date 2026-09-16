import { Info } from "lucide-react";
import { ICON_STROKE } from "../shell/nav";

/**
 * On anything that reads like a suggestion, and on nothing that is a plain
 * fact — a balance or today's change never carries it, so the label keeps its
 * meaning (DESIGN.md §4, CLAUDE.md hard line 12).
 */
export function NotAdviceLabel() {
  return (
    <div className="text-ink3 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.03em] uppercase">
      <Info size={13} strokeWidth={ICON_STROKE} aria-hidden />
      Information, not advice
    </div>
  );
}
