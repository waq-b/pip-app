/**
 * Is a market in its regular session? From Trading 212's working schedules
 * (`/equity/metadata/exchanges`): a session is open from an `OPEN` event until
 * the next event of any kind — `CLOSE`, or `AFTER_HOURS_OPEN` on US venues.
 * A holiday has no `OPEN`, so it reads as closed. Pre-market, after-hours and
 * overnight trading don't count: prices shown are regular-session prices.
 */
export interface ScheduleEvent {
  date: string;
  type: string;
}

export function isMarketOpen(events: ScheduleEvent[], now: Date): boolean {
  const at = now.getTime();
  let latest: ScheduleEvent | undefined;
  for (const event of events) {
    const time = Date.parse(event.date);
    if (time <= at && (!latest || time >= Date.parse(latest.date))) latest = event;
  }
  return latest?.type === "OPEN";
}

/**
 * The schedule runs out eventually; T212 publishes weeks ahead. Past its last
 * event Pip can't know, and says so rather than guessing.
 */
export function scheduleCovers(events: ScheduleEvent[], now: Date): boolean {
  return events.some((event) => Date.parse(event.date) > now.getTime());
}
