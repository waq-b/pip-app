import type { Pence } from "@finance-app/shared";

/** Small formatting helpers for Pip's own sentences. Pounds first, always. */

const pounds = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  maximumFractionDigits: 0,
});

/** Whole pounds, no sign: 20_912 → "£209". */
export function wholePounds(amount: Pence): string {
  return pounds.format(Math.round(Math.abs(amount) / 100));
}

/** 9.23 → "9.2%"; 7 → "7%". No sign. */
export function percentText(value: number): string {
  const rounded = Math.round(Math.abs(value) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** `2026-11-19` → "Thu 19 Nov". */
export function shortDate(day: string): string {
  return dayFormat.format(new Date(`${day}T00:00:00Z`)).replace(",", "");
}

export function inDays(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `In ${days} days`;
}

/** "Reuters", "Reuters and the FT", "Reuters, the FT and BBC". */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export const plural = (count: number, one: string, many = one === "more" ? one : `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
