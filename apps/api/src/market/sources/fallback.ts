import {
  PriceSourceError,
  type DailyClose,
  type PriceSource,
  type PriceTarget,
  type Quote,
} from "./types.js";

export interface Sourced<T> {
  value: T;
  /** Which source actually answered — the provenance line names this one. */
  source: PriceSource;
}

/**
 * Asks each source in order and returns the first answer, with the source that
 * gave it. A source is skipped when it has no symbol for the target (`symbolFor`
 * returns null) or fails; if every source fails, the last error is thrown.
 */
export function withFallback(
  sources: { source: PriceSource; symbolFor: (target: PriceTarget) => PriceTarget | null }[],
) {
  async function first<T>(
    target: PriceTarget,
    ask: (source: PriceSource, target: PriceTarget) => Promise<T>,
  ): Promise<Sourced<T>> {
    let lastError: unknown = new PriceSourceError(
      "yahoo",
      "unsupported",
      "no source can price this",
    );
    for (const { source, symbolFor } of sources) {
      const own = symbolFor(target);
      if (!own) continue;
      try {
        return { value: await ask(source, own), source };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  return {
    quote: (target: PriceTarget): Promise<Sourced<Quote>> => first(target, (s, t) => s.quote(t)),
    dailyCloses: (target: PriceTarget, from: Date): Promise<Sourced<DailyClose[]>> =>
      first(target, (s, t) => s.dailyCloses(t, from)),
  };
}
