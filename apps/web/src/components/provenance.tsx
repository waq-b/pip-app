/**
 * Where prices came from and how old they are. One small line, never a badge,
 * never a tooltip, never hidden behind an icon (DESIGN.md §5).
 *
 * These components only draw a state they're given. Deciding which state a
 * pot is in — green, amber or red — is the staleness ladder's job (task 21).
 */
export type ProvenanceState = "fresh" | "amber" | "red" | "closed";

export function ProvenanceLine({ state, text }: { state: ProvenanceState; text: string }) {
  const isAmber = state === "amber";
  const dot = isAmber ? "bg-amber-dot" : state === "red" ? "bg-dn" : "bg-up";

  return (
    <div
      className={`flex items-center gap-2 text-[11.5px] leading-snug ${
        isAmber ? "text-amber font-bold" : "text-ink3 font-semibold"
      }`}
      data-state={state}
    >
      <span aria-hidden className={`h-[7px] w-[7px] flex-none rounded-full ${dot}`} />
      {text}
    </div>
  );
}

/**
 * Beside any figure a stale pot feeds. Amber is a state, never a pot colour —
 * it never tints the figure itself (DESIGN.md §5).
 */
export function AgeChip({ hours }: { hours: number }) {
  return (
    <span className="bg-amber-tint text-amber rounded-full px-2 py-0.5 text-[10px] font-extrabold tracking-[0.04em] uppercase">
      {Math.floor(hours)}h old
    </span>
  );
}
