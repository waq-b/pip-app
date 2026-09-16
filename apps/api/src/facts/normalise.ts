import { createHash } from "node:crypto";

/** Tracking parameters that make one report look like several. */
const TRACKING = /^(utm_|oc$|ncid$|guccounter$|guce_)/;

export function canonicalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (TRACKING.test(key)) parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

/** `facts_news.id`: one row per report, however many sources lead to it. */
export function newsId(url: string): string {
  return createHash("sha256").update(canonicalUrl(url)).digest("hex");
}

/** `https://www.reuters.com/x` → `reuters.com`. Null when it isn't a web address. */
export function domainOf(url: string): string | null {
  try {
    const { hostname, protocol } = new URL(url.includes("://") ? url : `https://${url}`);
    if (protocol !== "https:" && protocol !== "http:") return null;
    return hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

/** Tags out, entities decoded, whitespace collapsed, cut to `max` characters. */
export function plainText(value: unknown, max: number): string {
  const text = String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export const HEADLINE_MAX = 300;
export const SNIPPET_MAX = 400;

/** RFC 822 dates, ISO dates, and Investing.com's `2026-09-16 22:55:12` (UTC). */
export function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    // A bare `YYYY-MM-DD HH:MM:SS` parses as local time; read it as UTC instead.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value.trim())) {
      return new Date(`${value.trim().replace(" ", "T")}Z`);
    }
    return direct;
  }
  return null;
}
