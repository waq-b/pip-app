import type { Change, Pence, Percent } from "@finance-app/shared";

/**
 * Every figure on every screen goes through here. Two rules from DESIGN.md §4
 * are enforced by the shape of these functions rather than by remembering them:
 *
 * - pounds before percent — `formatChange` takes a whole `Change` and always
 *   puts the money first, so there is no way to render a bare percentage
 * - decimals shrink so the pounds carry the weight — `splitPounds` hands the
 *   hero number its two parts separately
 */

/** A real minus sign, as the design sets it — not a hyphen. */
export const MINUS = "−";

const pounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const wholePounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const percent = new Intl.NumberFormat("en-GB", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** "£11,430.18", or "£11,430" when `whole` is set. Negatives carry a true minus. */
export function formatPounds(amount: Pence, options: { whole?: boolean } = {}): string {
  const absolute = Math.abs(amount) / 100;
  const text = options.whole ? wholePounds.format(Math.round(absolute)) : pounds.format(absolute);
  return amount < 0 ? `${MINUS}${text}` : text;
}

/** "+£25.80" / "−£34.20". Zero carries no sign — nothing went up or down. */
export function formatSignedPounds(amount: Pence): string {
  if (amount === 0) return formatPounds(0);
  const text = formatPounds(Math.abs(amount));
  return amount > 0 ? `+${text}` : `${MINUS}${text}`;
}

/**
 * The hero number in two parts, so the pence can be set smaller. Truncates
 * rather than rounds the whole part: £11,430.99 is "£11,430" and ".99", never
 * "£11,431".
 */
export function splitPounds(amount: Pence): { whole: string; fraction: string } {
  const absolute = Math.abs(amount);
  const whole = wholePounds.format(Math.floor(absolute / 100));
  const fraction = `.${String(absolute % 100).padStart(2, "0")}`;
  return { whole: amount < 0 ? `${MINUS}${whole}` : whole, fraction };
}

/** "0.23%", or "+0.23%" when signed. */
export function formatPercent(value: Percent, options: { signed?: boolean } = {}): string {
  const body = `${percent.format(Math.abs(value))}%`;
  if (value < 0) return `${MINUS}${body}`;
  if (options.signed && value > 0) return `+${body}`;
  return body;
}

/**
 * "+£25.80 · +0.23%". The only way to show a change, and it always leads with
 * the money (DESIGN.md §4.1).
 */
export function formatChange(change: Change): string {
  return `${formatSignedPounds(change.amount)} · ${formatPercent(change.percent, { signed: true })}`;
}

/** The token a change is coloured with. Flat is muted, never green. */
export function changeTone(change: Pick<Change, "direction">): "text-up" | "text-dn" | "text-ink3" {
  if (change.direction === "up") return "text-up";
  if (change.direction === "down") return "text-dn";
  return "text-ink3";
}
