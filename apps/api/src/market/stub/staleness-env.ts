import { BUCKETS, type Bucket } from "@finance-app/shared";
import type { StubStaleness } from "./index.js";

/**
 * `STUB_STALENESS` lets a developer walk the staleness ladder against the stub
 * without a real feed ever failing. Comma-separated `pot:state`, where pot is
 * Base, Medium, Degen or `all`, and state is an age in hours, `failed` or
 * `closed`:
 *
 *   STUB_STALENESS=Degen:2          amber on Side Bet
 *   STUB_STALENESS=Degen:failed     red card
 *   STUB_STALENESS=all:closed       markets closed
 *
 * Anything it can't read stops the server at startup rather than being ignored.
 */
export function parseStubStaleness(
  value: string | undefined,
): Partial<Record<Bucket, StubStaleness>> | undefined {
  if (!value?.trim()) return undefined;

  const result: Partial<Record<Bucket, StubStaleness>> = {};
  for (const part of value.split(",")) {
    const [pot, state] = part.split(":").map((piece) => piece.trim());
    const targets = pot === "all" ? BUCKETS : BUCKETS.filter((bucket) => bucket === pot);
    if (targets.length === 0 || !state) throw new Error(`STUB_STALENESS: can't read "${part}"`);

    let setting: StubStaleness;
    if (state === "failed") setting = { failed: true };
    else if (state === "closed") setting = { marketsClosed: true };
    else if (/^\d+(\.\d+)?$/.test(state)) setting = { hoursOld: Number(state) };
    else throw new Error(`STUB_STALENESS: can't read "${part}"`);

    for (const bucket of targets) result[bucket] = { ...result[bucket], ...setting };
  }
  return result;
}
