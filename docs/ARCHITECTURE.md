# Architecture

Living doc. Reflects what's actually built, not what's planned — check `docs/phases/phase-N.md` for what's coming. Last updated: Phase 4 — rules engine, after 0.3.0 (Kraken read-only) and 0.2.0 (Trading 212 practice accounts, market data, deployed on Render).

## Platform: Supabase (decided 2026-09-16)

Supabase for Postgres and Auth, with Fastify kept as the backend and the wall (CLAUDE.md s3).

**Built:** Supabase Auth end to end — sign-in in the browser and token verification in the API, see [Auth](#auth) — and Row Level Security switched on for every table. **Not built yet:**

- **RLS as a second wall.** Today RLS, with no policies, only shuts Supabase's REST API off from the tables; Fastify queries as a role that bypasses it. Making it a real wall behind the API means querying as a non-bypass role with the verified user's claims set per request, inside a transaction. That arrives with the first user-owned table in Phase 2 — built now it would guard nothing.
- **Scheduled work** from `pg_cron`. Price refresh, which touches no user secret, may run in an Edge Function. Anything that uses a provider key is triggered by `pg_cron` but executed by Fastify, because provider keys are never decrypted outside it (hard line 6).
- **Provider keys** encrypted with our own AES-256-GCM and a `MASTER_KEY` held in Render — not Supabase Vault (Phase 2).

**Not used:** Realtime, Storage. Phase 2 decisions are in `docs/phases/phase-2-inputs.md`.

## Monorepo layout

```
finance-app-personal/
├── CLAUDE.md
├── CHANGELOG.md
├── docs/
│   ├── ARCHITECTURE.md    ← this file
│   ├── FEATURES.md
│   ├── DESIGN.md          ← signed off; the visual source of truth
│   ├── design/            ← the Claude Design prototype, verbatim
│   └── phases/
│       ├── phase-0.md
│       ├── phase-1.md
│       ├── phase-2-inputs.md
│       └── phase-2.md
├── apps/
│   ├── web/                ← React frontend (Vite + TS + Tailwind v4 + PWA)
│   └── api/                ← Fastify backend
│       ├── fixtures/recorded/  ← real T212 practice / Yahoo / Alpha Vantage responses, anonymised, for tests to replay
│       └── src/
│           ├── app.ts       ← Fastify instance: guard, then routes
│           ├── server.ts    ← process entrypoint: config, redacted logger, listens on PORT
│           ├── config.ts    ← PROVIDER_MODE + master key, checked at startup
│           ├── logging.ts   ← pino redaction paths
│           ├── crypto/      ← secret box (AES-256-GCM), credential contexts, re-seal job
│           ├── auth/       ← Supabase JWT verification, allowlist, guard, /me, waitlist
│           ├── db/          ← schema, client, asUser (RLS scope)
│           │   ├── client.ts   ← lazy Drizzle/Postgres client (getDb())
│           │   ├── schema.ts   ← allowlist, waitlist, credentials, holdings, prices, daily values…
│           │   └── user-scope.ts ← asUser: queries as the signed-in user so RLS applies
│           ├── dev/         ← local-only tools (sign-in link without email)
│           ├── research/    ← RESEARCH (Phase 5): handed values, hands back words — walled off
│           ├── nudges/      ← candidates, profile, Groq chat client (outside the wall)
│           ├── facts/       ← FACTS (Phase 5): news and results dates for what's held
│           │   ├── types.ts    ← adapters declare coverage (regions, asset types)
│           │   ├── targets.ts  ← instrument → region, asset, aliases; which adapters cover it
│           │   ├── sources/    ← Google News, Marketaux, Alpha Vantage, RSS feeds
│           │   ├── stub.ts     ← deterministic facts incl. the planted ASML item
│           │   ├── collect.ts  ← due, budget, read, store, clean up — a refresh-job step
│           │   └── live.ts     ← the real source list from configured keys
│           ├── fixtures/   ← the design's sample words and numbers
│           ├── jobs/        ← scheduled refresh: job-secret route + the job
│           ├── market/     ← MARKET DATA: what it's worth, what it's done
│           │   ├── market.ts   ← stub-mode market interface
│           │   ├── stub/       ← deterministic fake prices
│           │   ├── sources/    ← Yahoo, Alpha Vantage, fallback
│           │   ├── refresh.ts  ← shared price cache and when prices are due
│           │   ├── budget.ts   ← daily call budgets per source
│           │   └── hours.ts    ← market open/closed from T212 schedules
│           ├── providers/  ← TRADING: what is held, how much cash
│           │   ├── provider.ts ← stub-mode trading interface
│           │   ├── stub/       ← fake holdings, used in stub mode and tests
│           │   └── t212/       ← read-only practice client, rows, ticker → symbols
│           ├── read/        ← read models: stub sample data, live real accounts
│           ├── routes/     ← thin routes: read, connections
│           ├── sync/        ← connect, poll, history backfill, daily snapshots
│           ├── valuation/   ← holdings → pounds, one place
│           └── web.ts       ← production: web app + API on one origin
└── packages/
    └── shared/              ← types shared between web and api
        └── src/
            ├── buckets.ts    ← BUCKETS, Bucket, BUCKET_META (display names)
            ├── rules.ts      ← rule defaults and limits (Phase 4)
            ├── research.ts   ← trust rule defaults and limits, profile limits, nudge kinds/reasons (Phase 5)
            └── api.ts        ← response types for every API route
```

`research/` (Phase 5 task 6) is walled off — see [Research](#research-research-phase-5). Don't scaffold them early. `auth/` and `market/` arrived in Phase 1: `market/` earlier than originally planned, because instrument charts need price history and prices may never come from a trading API.

## Brand assets and fonts (Phase 1)

The Claude Design handover ("Pip") lives in the repo, not just in the design tool:

- `docs/design/Pip.dc.html` — the original prototype, kept as the reference for every screen and state. Read-only; it is never built or imported.
- `apps/web/src/assets/brand/` — the logo mark as SVG. The mark has **two cuts**: standard geometry for 48px and up (`pip-mark.svg`, `-dark.svg`, `-reversed.svg`, `-mono.svg`) and a small cut for 16–48px (`pip-mark-small.svg`), where the radii compress and the centres push out so the third seed survives. App-icon artwork: `pip-icon.svg` (standard cut on cream) and `pip-icon-maskable.svg` (small cut reversed on a full-bleed terracotta plate, inside the Android safe circle).
- `apps/web/public/` — the rasterized outputs: `favicon.svg` (one-ink small cut on a cream disc), `apple-touch-icon.png`, `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png`. Regenerate with `sips -s format png --resampleWidth <n> <src>.svg --out <dest>.png`.
- Fonts are self-hosted via `@fontsource/caprasimo` and `@fontsource-variable/figtree`, imported in `apps/web/src/index.css`. No Google Fonts request at runtime. Icons come from `lucide-react`.

The PWA manifest (`apps/web/vite.config.ts`) and `index.html` carry the Pip name, the cream/dark theme colours and these icons.

## Bucket model

Three buckets, defined once in `packages/shared/src/buckets.ts`:

```ts
export const BUCKETS = ["Base", "Medium", "Degen"] as const;
export type Bucket = (typeof BUCKETS)[number];
```

Both apps import this — nothing hardcodes bucket names elsewhere. Each bucket maps to exactly one trading provider (Base/Medium → Trading 212, Degen → Kraken); see CLAUDE.md section 1 for what each bucket is for.

**Display names are a UI concern only.** `BUCKET_META` maps each id to what the screen calls it (Foundation, Handpicked, Side Bet), the accent scope the theme keys off (`fnd`/`pick`/`bet`), and the provider named in the read-only footer. The ids never reach a screen and the display names never reach the API or the database, so renaming a pot is a one-line change with no migration.

## API types

`packages/shared/src/api.ts` holds the shape of every response `apps/api` returns and `apps/web` consumes — types only, no logic and no formatting. Conventions that matter:

- **Money is integer pence** (`Pence`), so nothing rounds in transit. `Percent` is percentage points.
- **Every `Change` carries both** an amount and a percent, which is what makes "pounds before percent" (DESIGN.md §4.1) impossible to break by accident.
- **`PriceFreshness`** carries the market-data source, the last successful read, whether the last fetch failed, and whether markets are closed. It names a market-data source, never a trading API (hard line 8). Deriving the green/amber/red state from it is the web app's staleness ladder (`apps/web/src/lib/staleness.ts`), not these types.

## Web app

`apps/web` is a Vite + React 19 PWA. Structure so far:

```
apps/web/src/
├── index.css            ← every DESIGN.md token, as CSS variables + Tailwind v4 theme
├── App.tsx              ← query client, router, appearance
├── routes.tsx           ← the route table
├── lib/
│   ├── api.ts           ← the only way to reach the API; bearer token, 401 and 403 are their own errors
│   ├── auth-client.ts   ← Supabase, behind a four-method interface
│   ├── auth-context.ts  ← useAuth()
│   ├── me.ts            ← useMe(): allowed or not
│   ├── format.ts        ← every figure: pounds before percent, true minus signs
│   ├── theme.ts         ← appearance: follow the device, or a stored choice
│   └── use-appearance.ts
├── components/          ← the data display system (DESIGN.md §7)
│   ├── big-number.tsx, progress-cap-bar.tsx, provenance.tsx, not-advice-label.tsx, skeleton.tsx
│   ├── sparkline.tsx, line-chart.tsx, bar-chart.tsx, allocation.tsx, holdings-table.tsx
│   ├── chart-geometry.ts ← path maths, tested once for flat series and single points
│   └── shades.ts        ← per-holding shades as opacity steps of the pot accent
├── shell/
│   ├── app-shell.tsx    ← chrome around every signed-in screen
│   ├── nav.ts           ← the three destinations, and what lights each one
│   ├── use-breakpoint.ts
│   ├── pointer-words.ts ← tap/click, phone/computer
│   ├── pip-mark.tsx     ← the mark, choosing its own cut by size
│   ├── auth-provider.tsx
│   └── require-session.tsx ← routes by the two walls
└── screens/             ← sign-in, not-on-the-list, pots (home, with the Your week card), pot detail, holding detail, your week, rules, setup
```

**Tokens.** `index.css` declares every colour as a `--pip-*` variable for light, overrides them for dark, and maps them into Tailwind with `@theme inline` — so `bg-card` resolves to the live variable and dark mode is a variable swap, never a second set of classes. Pot scopes (`.pot-fnd`, `.pot-pick`, `.pot-bet`) override only the accent trio, so anything inside one paints itself in that pot's colour without knowing which pot it is. No component carries a hex value — and `shell/pip-mark.test.tsx` enforces that rather than trusting it, because two slipped through before the test existed and both broke dark mode. The mark's seeds and the alert dot have their own tokens (`--pip-seed-fnd/pick/bet`, `--pip-alert`), as do the provider swatches on Setup (`--pip-swatch-trading212`, `--pip-swatch-kraken`, brand colours identical in both themes), separate from the accent, because they must not change when a pot scope does.

**Retries are decided once, app-wide** (`App.tsx`), not per hook: a 4xx — signed out, not on the list, no such pot — is never retried, because asking again only delays the right screen; 5xx and network errors get two more tries. Tests use `retry: false` so error states render immediately.

**Appearance.** Follows the device until someone chooses in Setup. The `data-theme` attribute is written only for an explicit choice; leaving it off for "system" keeps the media query in charge, so the app follows the device live rather than at load. Storage access is wrapped, because private browsing throws rather than returning null.

**The shell.** Signed-in screens render inside `AppShell`; sign-in and the not-on-the-list screen deliberately don't, because neither has a sidebar or a hero number. Three layouts, one set of destinations:

| Width     | Navigation                                       | Content cap |
| --------- | ------------------------------------------------ | ----------- |
| under 768 | tab bar along the bottom                         | —           |
| 768+      | 76px icon rail                                   | 640         |
| 1120+     | 232px labelled sidebar, with the read-only badge | 1080        |

**Active state comes from `nav.ts`, not from the router.** Each destination has its own `matches(pathname)`, and every layout uses it. This isn't a style choice: React Router's `NavLink` computes `aria-current` from its own path matching and overwrites the prop you pass, so with `end` on the Pots link it went dark the moment you opened a pot. Pot detail and instrument detail live under Pots, so Pots has to stay lit there.

**Your week** (`lib/week.ts`, `screens/week-card.tsx`, `screens/week.tsx`, Phase 5). `useWeek` (`["week"]`) reads `GET /week`; `usePastWeek` reads `/week/:weekOf`; `useRespond` posts `/nudges/:id/response` and invalidates `["week"]`. The card replaced Pots' What changed (the web `ActivityFeed` and `useActivity` are gone; the API's `/activity` still answers). `/week` and `/week/:weekOf` are routes under the shell, and `nav.ts` keeps Pots lit there. Dates use fixed month names (`shortDay`), because browsers disagree on "Sep" and "Sept". Sources open in a new tab with `noopener noreferrer`.

**Trust rules and plan** (`lib/research-settings.ts`, `screens/trust-rules-section.tsx`, `screens/your-plan.tsx`, Phase 5). `useTrustRules` / `useProfile` read `GET /trust-rules` and `/profile`; the save mutations `PUT` once on Save, put the answer straight into the cache and invalidate `["week"]`. Limits come from `TRUST_LIMITS` and `PROFILE_LIMITS` in the shared package — the same constants the API enforces. `publisherDomain` mirrors the API's normalisation so a chip shows what will be stored. Pounds typed into the plan become pence before sending.

**The Rules dot is fed by `RequireSession`.** Once `/me` says you're allowed, it also asks `GET /rules` (`lib/rules.ts`) and passes `rulesNeedAttention` to the shell when any rule carries `overBy`. It shares the `["rules"]` query with the Rules screen, so opening Rules costs no second request. A failure there just means no dot — it never blocks the app.

**Setup keeps connection outcomes in the query cache.** Phase 1's `/connections` routes store nothing, so refetching after a connect or disconnect would undo it on screen. `lib/connections.ts` writes the outcome into the `["connections"]` cache instead; Phase 2's encrypted storage makes the server agree and this can become an invalidate. The pasted key lives only in the connect card's input state until it's sent, then only a masked copy (`maskKey`) is kept for showing back. Refusing a key that can trade is the API's decision (`inspectKey`); the screen only explains it.

**Per-device preferences live in localStorage, wrapped.** Appearance (`lib/theme.ts`, `pip.appearance`) and Hide the numbers (`lib/hide-numbers.ts`, `pip.hide-numbers`, read through `useSyncExternalStore` so every `BigNumber` updates when Setup flips it). `BigNumber` blurs its figures behind a "Show the numbers" button when the setting is on.

**The staleness ladder is one pure function.** `lib/staleness.ts` `ladder(entries, {single?})` takes `BucketFreshness[]` and returns the provenance state and line, which pots get an age chip (`chipped`), which dim (`dimmed`) and, on red, the card's words. Pots, pot detail and holding detail all call it and only place what it returns (`ProvenanceLine`, `AgeChip`, `components/stale-card.tsx`, `opacity-60`), so they can't disagree. Rungs per pot: failed → red; markets closed → closed (green, whatever the age); over 6h → red; 1h and up → amber; else fresh. Across pots, any red wins and amber stands down; three pots amber at once also goes red — that rule is skipped with `single`, which pot and holding detail pass so the line doesn't name the pot you're already on. Ages are measured against `Date.now()` in the browser, from the API's `asOf`. The red card's Try again refetches that screen's query.

**The mark** is a component rather than an imported SVG so it can pick its cut: below 48px it draws the small cut (DESIGN.md §3), which the rail and sidebar need at 26–27px. The SVG files remain the source for favicons and app icons.

**Testing.** jsdom has no `matchMedia`, so `src/test/setup.ts` installs a stub that answers `min-width`/`max-width` queries against a width the test sets with `setViewportWidth()`, and notifies listeners when it changes. Shell tests run at 390, 834 and 1280.

**Formatting enforces the copy rules by shape.** Every figure goes through `lib/format.ts`. `formatChange` takes a whole `Change` and always renders the money first, so there is no function that renders a bare percentage — "pounds before percent" (DESIGN.md §4.1) can't be broken by forgetting it. `splitPounds` hands the hero number its pounds and pence separately so the pence can be set smaller, and truncates rather than rounds (£11,430.99 is never "£11,431"). Losses use a true minus sign, and a flat change is muted rather than green.

**The data display system** (`components/`) is the design's seven blocks plus four supporting pieces. Each takes plain data and draws it; none fetches, and none decides a state it's given (the provenance line draws green/amber/red, but deriving which belongs to the staleness ladder). Rules each one enforces:

- `BigNumber` — money before percent, pence set small.
- `ProgressCapBar` — fill is where you are, the ink tick is your line. Only a breached _cap_ goes red and hatched; a target you've passed stays calm. A cap can take a `scaleMax` so 5% isn't an invisible sliver, and states the breach in pounds.
- `LineChart` — `caption` is a required prop, because there is no chart without a sentence; it doubles as the accessible description. Fewer than two points draws a message instead of a line. Each instance gets its own gradient id, or a second chart silently paints with the first one's colour.
- `BarChart` — value labels above the bars; a zero month is a faded stub, never a gap.
- `AllocationRing` — arcs use the pots' identity colours (`--pip-seed-*`), which no scope can change; the target is a sentence, never a second ring.
- `HoldingsTable` — three columns on a phone, four on desktop. Every change shows pounds before percent — deliberately stricter than the prototype, which showed bare percentages here. A holding keeps its shade when the list is re-sorted.
- `Sparkline` — hidden from assistive tech; the figure beside it carries the meaning.

`components/no-hex.test.ts` globs every file in the folder via `import.meta.glob(..., { query: "?raw" })`, so a component added later is covered by the no-hex rule without anyone listing it, and the test fails if the glob ever finds nothing.

## Data flow

```
                                   PROVIDER_MODE=stub
apps/web  →  /api  →  routes  →  read/stub.ts  →  providers/stub, market/stub, fixtures/

                                   PROVIDER_MODE=t212
apps/web  →  /api  →  routes  →  read/live.ts  →  Postgres, read as the user (RLS)
                                      │               ↑ holdings, cash, trades   ← sync/ ← providers/t212 (practice API)
                                      │               ↑ prices, closes, series   ← market/ ← Yahoo → Alpha Vantage
                                      └─ refresh-on-read (≤ 2 s)                  ↑ both also driven by jobs/ ← pg_cron
```

The frontend never talks to a provider directly and never knows which provider backs a bucket — it only ever calls our own API, always under `/api` (`lib/api.ts`). In dev, Vite proxies `/api` to the Fastify server and strips the prefix, so the API's own paths stay `/rules`, `/portfolio` and so on. The prefix is not cosmetic: several API paths are also screens (`/rules`, `/instruments/:id`), and proxying the bare paths sent a page load or reload of those screens to the API. Test stubs are still keyed by the API's own path; `test/render-route.tsx` strips the prefix. That indirection is the point: Phase 2 swapped real Trading 212 data in behind the same API, and the only web changes were new states (not connected, syncing, not enough history, coming soon).

**The read routes** (`routes/read.ts`), all behind both auth walls:

| Route                                              | Returns                                                                                                                            |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /portfolio?tf=day\|month\|all`                | The hero total, its change, the verdict line, all three pots, and freshness per pot                                                |
| `GET /buckets/:id?tf=`                             | One pot: value, chart with its caption, money-in bars, and its holdings. `:id` is the internal id (`Base`), never the display name |
| `GET /instruments/:id?range=day\|month\|year\|all` | One holding: price, value, today, since-you-bought, the plain-English note, its series                                             |
| `GET /rules`                                       | Targets and the cap, what each pot actually sits at, and how far over Side Bet is — in pounds as well as percent                   |
| `GET /activity`                                    | The last week, in plain English                                                                                                    |
| `GET /connections`                                 | Which providers feed which pots                                                                                                    |

An unknown pot or holding is a 404; an unrecognised timeframe or range is a 400 rather than a silent fallback. Composition is deliberately one-way: routes ask the trading layer what is held and the market layer what it is worth, and never the reverse.

**Read models** (`read/`). The routes validate input and call a `ReadModel` — `portfolio`, `bucket`, `instrument` (null → 404), `rules`, `activity` — for the signed-in user. `stubReadModel` (stub mode) is Phase 1's sample data, unchanged. `liveReadModel` (Trading 212 mode):

- **Refresh first, briefly.** Due prices for what the user holds are refreshed (shared, privileged) but a read waits at most 2 s; a slow source keeps refreshing in the background and the staleness ladder reports the real age.
- **Reads as the user** (`asUser`), so RLS decides what's visible: credentials, holdings, cash, trades, daily values, shared prices and schedules.
- **Values** are quantity × market price × pounds per unit, in pence (`valuation/value.ts`); a pot's value is its invested value plus cash. **Today** is measured from the previous close — except for something first bought today (per order history), where it's measured from what was paid, because the rise before buying wasn't the user's. **All time** is invested value − cost (T212's fee-exclusive basis). **This month** compares invested value with the pot's daily value at the close a month ago; without one, `changeUnavailable` is set rather than inventing a number. A pot with an unpriced holding also can't state a change.
- **Pot status**: `not_connected` with no credential (for Side Bet, no Kraken credential) — excluded from totals, shares and rules; `syncing` until the first poll and history rebuild finish; otherwise `live`.
- **Charts** come from `daily_values` (investments only), captioned from the line itself ("Your investments here are up £50.00 since 10 Sep, not counting cash."); pot sparklines are the last 31 days. A holding's chart is intraday points for Day and daily closes for Month / Year / All (All from the first trade), gap-filled on demand through the budgeted sources; sparklines use the last month of closes.
- **Cash** is a holding row named "Cash", `linkable: false`.
- **Freshness** per pot, only for connected pots holding something (an empty pot has no source to name): sources that actually priced it, oldest `asOf`, `failed` if a holding has no price or its last refresh failed, `marketsClosed` if every holding's T212 schedule says closed — crypto has no schedule, so Side Bet is never closed; with nothing priced the source defaults to CoinGecko for Side Bet. Crypto quantities read in coins ("0.01 BTC"); a holding's subtitle is its ticker, "BTC · incl. 0.5 staked" for staked coins, or "No price yet". A holding with unknown cost gets `sinceBoughtUnavailable` and its pot's all-time change is unavailable.
- **Not built from real data yet, and saying so**: `activityComingSoon`, `moneyIn.comingSoon`, `monthlySplit.comingSoon`, empty instrument `note` (Phase 5), a pot's rule `available: false` (status `unavailable`) while it isn't connected. Verdicts are "Up/Down £X today." then "Nothing needs you." or, with a broken cap, "Side Bet needs a look." (rules engine).
- Tested on PGlite (values, today/all/month, bought-today, Side Bet, freshness, a second user seeing nothing, cash row, chart caption, intraday, 404, rules) and run against the practice ISA: £5,003.07 across four holdings on Yahoo prices.

**The server** (`server.ts`) builds the stub or real set from `PROVIDER_MODE`. In `t212` mode: `liveReadModel`, `liveConnectionService` (starting history rebuild in the background on connect), `createRefreshJob`, all on the privileged `getDb()` with `liveMarket`; `T212_ENV` must be `demo` until Phase 7; `JOB_SECRET` must be at least 32 characters when set.

**Connecting an account** (`routes/connections.ts`) — `GET /connections`, `POST /connections/:provider` (body `{ accountKind?, key, secret? }`) and `DELETE /connections/:provider?accountKind=`, all behind the guard. The routes parse and hand over to a `ConnectionService`; which one depends on the mode.

- **One row per account.** `Connection` has an `id` (`trading212:isa`, `trading212:invest`, `kraken`), `accountKind`, `available` (false for Kraken until Setup can take its private key, Phase 3 task 8 — the API already connects it) and `permissionsVerified` (Kraken true; Trading 212 false, because T212 can't report a key's permissions). A Trading 212 request without `accountKind` is a 400.
- **One account, one pot.** A Trading 212 credential stores the account's own id (`provider_account_id`, from the summary; migration 0012), set on connect and refreshed on every poll. Connecting a key whose account already feeds the user's other Trading 212 pot is refused with `same_account` before anything is stored (hard line 11).
- **Every verdict is a 200**, with the outcome in the body: `connected`, `invalid_key`, `too_much_access`, `missing_permission` (+ `missingPermission`), `not_pounds`, `unavailable`, `not_available_yet`. The message's first sentence is the card heading. No response echoes a key.
- **Stub mode** (`stubConnectionService`) keeps Phase 1's behaviour: it judges the key's shape (too short, or carrying `trade`/`withdraw`) and stores nothing; listing returns the design's three accounts.
- **Trading 212 mode** (`sync/connections.ts`, `liveConnectionService`): validates the key and secret against the practice API (account summary + positions) **before storing anything**; seals both halves (bound to user, provider, account kind and field); upserts one credential per user + provider + account kind, so reconnecting replaces the key; runs the first poll with the data it already read (no second wait on T212's 1-per-5s limit); and calls `onConnected` (history backfill, task 10). Listing reads as the user, so RLS applies. Disconnecting deletes the credential — cascading to its holdings, cash and trades — and that pot's `daily_values`, since that history came from the account. Kraken answers `not_available_yet`.
- Checked end to end against the practice ISA and the dev database: sealed, 4 holdings, instruments and schedules learned, listed as the user.

## Provider interface

`apps/api/src/providers/provider.ts`:

```ts
interface Provider {
  bucket: Bucket;
  getPositions(): Promise<Position[]>;
  getCash(): Promise<CashBalance>;
  getHistory(): Promise<HistoryEntry[]>;
}
```

`StubProvider` (`apps/api/src/providers/stub/index.ts`) returns fixed fake data per bucket for stub mode. Its `Position` carries a `value`, which only the stub may do; real providers never supply values.

### Trading 212 (`providers/t212/`, Phase 2)

- **`client.ts`** — read-only client for the **practice environment only** (`env: "demo"`; anything else throws until Phase 7). HTTP Basic `key:secret`. Every request is a `GET` to an allowlisted path (summary, positions, instrument and exchange metadata, order history); a test reads the source and fails if a write method, `equity/orders` or `pies` ever appears. Methods: `accountSummary`, `positions`, `instruments`, `exchanges`, and `fills()` — an async generator following `nextPagePath` cursor pages, skipping unfilled orders.
- **Errors are typed**: `T212AuthError` (401, never retried), `T212PermissionError` naming the missing permission (T212's 403 is bare, so it's inferred from the endpoint), `T212UnavailableError` (5xx, network, or 429 after retries), `T212ShapeError` (a field Pip relies on is missing — the beta API changed).
- **Rate limits** come from T212's own headers: when `x-ratelimit-remaining` hits 0 the next call to that endpoint waits until `x-ratelimit-reset`; a 429 waits and retries twice, then gives up.
- **`rows.ts`** — responses → stored rows: holdings (quantity and average price at full precision, total cost in pence), cash in pence, instruments, and trades (net value and fees in pence). `currentPrice` and `walletImpact.currentValue` are dropped (hard line 8). Anything not in pounds raises `NotInPoundsError`.
- **`symbols.ts`** — T212 ticker → Yahoo and Alpha Vantage symbols from the exchange the ticker encodes (`GRGl_EQ` → `GRG.L` / `GRG.LON`, `ASMLa_EQ` → `ASML.AS` / `ASML.AMS`, `NVDA_US_EQ` → `NVDA`). Unknown formats give null, for a manual override.
- Tests replay `fixtures/recorded/t212/`; the client was also run once against the practice account (summary, 4 holdings, 4 fills across pages, 17 exchanges).

### Kraken (`providers/kraken/`, Phase 3)

- **`client.ts`** — read-only client for Kraken spot. Kraken has no practice mode, so it reads a real account and can call exactly three private methods: `GetApiKeyInfo` (the key's own permissions and IP allowlist), `BalanceEx` and `Ledgers`. A test reads the source and fails if anything order-, withdrawal-, deposit-, earn- or transfer-shaped appears. Each call is a signed `POST` (`signRequest`: HMAC-SHA512 over path + SHA-256(nonce + body), checked against Kraken's documented example). Calls are queued one at a time so nonces always increase; a local counter mirrors Kraken's rate limit (max 15, −0.33/s, ledger pages cost 2) and a rate-limit error waits and retries twice. Errors are typed: `KrakenAuthError` (unknown key or bad signature), `KrakenPermissionError` (names the missing permission), `KrakenUnavailableError`, `KrakenShapeError`. Amounts arrive as decimal strings and are parsed to numbers; `ledger()` is an async generator following offset pages of 50.
- **`permissions.ts`** — `checkKrakenPermissions`: a key must have `query-funds` and `query-ledger`; `query-open-trades`, `query-closed-trades` and `export-data` are tolerated; anything else — including permission names Pip doesn't know — is refused and listed.

## Syncing provider accounts (`sync/`, `valuation/`, Phase 2)

- **`pollCredential(db, box, credential, clientFor)`** opens a credential's sealed key and secret in memory, hands them straight to a T212 client, reads the account summary and positions, and replaces that account's `holdings` and `cash` in one transaction (so a sold holding disappears). Instruments it hasn't seen are fetched from T212's metadata with their working schedules into `instruments` and `market_schedules`; metadata is otherwise refetched at most daily. Outcomes: `polled`, `invalid_key` (status → `invalid`), `missing_permission` (→ `error`, names the permission), `not_pounds` (→ `error`), `unavailable` (nothing changed; try later). Runs on the privileged connection.
- **`pollKraken(db, box, credential, clientFor, directory)`** (`sync/kraken.ts`, Phase 3) first re-reads the key's permissions — a key edited at Kraken to trade or withdraw is marked `error` and not read (`too_much_access`). Then `BalanceEx` becomes Side Bet `holdings` and `cash`, and new `Ledgers` entries (newest first, stopping at the first one already stored) go into `kraken_ledger`, all in one transaction. `baseAsset` folds Kraken's views of a coin into one holding: internal names via the public `Assets` list (`XXBT` → `XBT`), staked/reward/bonded suffixes (`DOT.S`, `DOT28.S`) counted in `staked_quantity`. Holdings are instruments `kraken:<altname>`, type `CRYPTO`, priced in GBP; a coin Pip hasn't met gets its name and CoinGecko id from CoinGecko and its pounds pair from Kraken's public `AssetPairs` (the `CoinDirectory`, public market data only). After storing new entries it sets each holding's cost from the ledger (`applyKrakenCosts`, cached closes only — no fetching). Fiat: GBP as is, USD/EUR at the cached FX rate, other currencies left out; held amounts count as reserved. Outcomes as for T212, plus `too_much_access`.
- **Connecting Kraken** (`connections.ts`): needs key + private key; `GetApiKeyInfo` must show `query-funds` and `query-ledger` and nothing that can move money — otherwise `too_much_access` lists every required and refused permission by its Kraken name, or `missing_permission` names the one to tick. Only then is the key sealed (account kind `spot`) and polled; if that first poll fails the credential is removed again. Disconnecting deletes the credential (holdings, cash, ledger cascade) and Side Bet's daily values. Kraken is only offered when `COINGECKO_KEY` is set, because new coins can't be named or priced without it. The refresh job polls Kraken credentials with `pollKraken` and rebuilds pending Kraken history with `backfillKrakenHistory`; a new Kraken connection starts it in the background.
- **Side Bet history and cost** (`sync/kraken-history.ts`, Phase 3). `createLedgerBook` replays stored ledger entries grouped by `refid`: quantities come straight from each entry's balance-after (summed across a coin's staked views), and cost is average cost in pence — bought with GBP/USD/EUR at what was paid (that day's FX close, fees excluded); swapped in, deposited or transferred in at that day's close (unknown → `null`, which clears once the coin is fully gone); staking and earn rewards free; spot↔staking transfers and earn allocations change nothing; anything leaving takes cost in proportion. `backfillKrakenHistory` fetches the coins' closes (CoinGecko for the last year, Kraken public further back; if the far end can't be had, the last 364 days), checks the replayed ledger ends at current holdings (else `holdings_mismatch`, nothing written), writes Side Bet `daily_values` up to yesterday (unknown cost counted as value; snapshots never overwritten), sets holdings' cost, and records `history_starts_on` — the same outcomes and statuses as the Trading 212 rebuild.
- **`credentialsDue`** lists `live`/`error` credentials not polled recently, for the scheduled job.
- **`snapshotDailyValues(db, userId, day)`** writes each pot's **invested** value and cost for the day into `daily_values` (`source: snapshot`) from the latest holdings and cached prices. **Cash isn't included** — on either side — because rebuilt history can't know past cash reliably, and the chart must not jump where rebuilt days meet live ones; cash is shown at its current amount instead. A pot with an unpriced holding is skipped, never written wrong. Days are London calendar days (`londonDay`).
- **`backfillHistory(db, box, credential, clientFor, marketFor)`** (Phase 2 decision 6) rebuilds a pot's past from order history: reads every fill into `trades` (keyed by fill id, so reruns never double-count), gap-fills daily closes and FX for the instruments involved, then walks each London day from the first trade to yesterday — quantity held × that day's close (carried over weekends and holidays) × that day's FX — into `daily_values` (`source: backfill`). Cost uses average-cost bookkeeping on the **same basis as Trading 212's `totalCost`**: a buy adds its net value minus fees and taxes; a sell removes cost in proportion. It **refuses to guess**: if the fills don't add up to what the account holds now (transfers in, pies, missing pages), nothing is written and history starts today (`partial`, `holdings_mismatch`); days before every holding can be priced are skipped (`partial`, `prices_missing`). A rebuilt day never overwrites a real snapshot. Status and `history_starts_on` are kept on the credential; a failure marks it `failed` without half-writing. Capped at five years. Run once against the practice ISA: four fills, matching holdings, no past days (all bought today).
- **`valuation/value.ts`** — the one place a holding becomes pounds: quantity × market price × pounds per unit (GBP 1, GBX 1/100, USD/EUR ÷ the GBP rate), rounded to pence. A missing rate throws rather than guesses. `bucketForAccountKind`: `isa` → Foundation, `invest` → Handpicked.
- Tested on PGlite with recorded T212 responses: the practice ISA snapshots within 0.2% of Trading 212's own total.

## Scheduled refresh (`jobs/`, `drizzle/0006`, `.github/workflows/keep-supabase-awake.yml`)

- **`POST /jobs/refresh`** is the scheduler's door. It's a **machine caller**: the guard (`JOB_PATHS`) requires `x-job-secret` to match `JOB_SECRET` (compared as SHA-256 digests with `timingSafeEqual`) instead of a user token, and refuses everyone when no secret is configured — still authenticated, so hard line 4 holds; the route-coverage test sees it answer 401. It answers **202 immediately** and runs the job afterwards, because a sleeping Render instance takes about a minute to wake.
- **The job** (`createRefreshJob`) runs seven idempotent steps, each isolated so one failing doesn't stop the rest: poll accounts not polled in 25 minutes; rebuild history for one account still `pending`; refresh due prices for everything held; snapshot today's pot values for everyone with a live account; collect facts for what's held (Phase 5, see [Facts](#facts-facts-phase-5)); build Your week and daily nudges for everyone with a live account (see [Your week](#your-week-nudges-phase-5)); fill in nudge outcomes. A second trigger while one is running joins it rather than starting another.
- **`pg_cron`** (migration 0006) calls `private.request_refresh()` every 30 minutes on weekdays 07:00–21:59 UTC and once daily at 22:00 UTC. That function reads the URL and job secret from `private.job_settings` — a single row written at deploy, never in git, unreadable to `anon`/`authenticated` — and `net.http_post`s with a 90-second timeout. Without the row it does nothing. The migration is guarded, so a database without `pg_cron`/`pg_net` (PGlite in tests) still applies it. `pg_net` lives in the `extensions` schema (0007), per Supabase's security advisor. Off-hours cadence keeps Render awake only during market hours, which matters because its 750 free hours are shared across the workspace. **Crypto** (migration 0010): `private.request_crypto_refresh()` runs hourly outside those hours — weekday 23:00–06:59 UTC and weekends except 22:00 — and only calls `request_refresh()` when some holding is a `CRYPTO` instrument, so nobody holding crypto means no extra wake-ups. Holding crypto adds roughly 100 awake hours a month on Render's free plan (each hourly wake keeps the instance up ~15 minutes).
- **Refresh-on-read** in the routes (task 12) covers anything the schedule misses.
- **Keep-alive**: free Supabase projects pause after about a week of low activity, and scheduled jobs inside the database aren't documented as activity. A GitHub Actions workflow queries Supabase's REST API every three days with the publishable key (public by design; stored as repository secrets `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`). RLS refuses the read, but the request still reaches the database.

## Rules engine (`rules/engine.ts`, Phase 4)

The one place that judges the shape. `evaluateRules(pots, settings)` is pure — no I/O, no clock — so every route gets the same answer for the same input. Settings are two whole numbers (`RuleSettings` in `packages/shared/src/rules.ts`): Handpicked's target and Side Bet's cap; `shapeOf` makes Foundation the remainder. Shared constants: `DEFAULT_RULES` (25 / 5, so 70 / 25 / 5), `SIDE_BET_CAP_MAX` 20 (the API refuses more), `SIDE_BET_CAP_NOTE_ABOVE` 10 (a calm FCA note on screen, blocking nothing), `DRIFT_THRESHOLD_POINTS` 5.

- **Shares** are each connected pot's value (investments + cash) over all connected pots; an unconnected pot is `unavailable`.
- **Targets are scaled over connected pots**: with Handpicked missing, Foundation's 70 is judged against 70 / (70 + 5) = 93.33. `scaled` and `leftOut` say when that happened. A target has **drifted** at 5 points or more either way — calm, never `needsAttention`.
- **The cap is never scaled** and is broken when Side Bet is over it by any amount (compared in integer pence, so exactly at the cap is fine). `overBy` gives points and pence; `needsAttention` is true only for a broken cap.
- **Fix-it amounts** when the cap is broken — arithmetic, not advice: `outOfSideBetPence` = ⌈(100·value − cap·total) / (100 − cap)⌉ (money leaving Side Bet and Pip's pots), `intoOtherPotsPence` = ⌈100·value / cap − total⌉ (new money into the other pots; null at a 0 cap). Both are the smallest whole pence that land on or under the cap.

### Saving rules (`rules/settings.ts`, `rules/store.ts`, `routes/rules.ts`)

- **`PUT /rules`** `{ handpickedTarget, sideBetCap }` — behind the guard like every route. `parseRuleSettings` enforces the limits on the server: whole numbers, cap 0–20, target 0–100, target + cap ≤ 100 (Foundation can't go negative); anything else is a 400 naming why (`whole_numbers_needed`, `cap_out_of_range`, `target_out_of_range`, `shape_over_100`). Answers `{ settings, lastChangedAt }`.
- **`RulesStore`**: `dbRulesStore` (real accounts) reads as the user through RLS and saves on the privileged connection; `memoryRulesStore` (stub mode) keeps rules per user in memory. No row means `DEFAULT_RULES` with `updatedAt: null`.
- **`user_rules`** (migration 0011): one row per user, own-row RLS, and the same limits as `CHECK` constraints — a second wall behind the API.

### Profile and trust rules (`nudges/profile.ts`, `rules/trust-settings.ts`, `routes/research-settings.ts`, Phase 5)

Two per-user settings the research build reads (task 7). Neither can move money or change the shape rules; a test saves both and checks `/rules` is untouched.

| Route              | Does                                                                                                                                                                                                                                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /profile`     | `ProfileView`: the profile (empty until saved), `personalised` — the allowlist's `personal_research` flag, carried on `request.allowedUser` — and `lastChangedAt` once saved                                                                                               |
| `PUT /profile`     | `parseProfile`: goals and risk words trimmed, ≤ 280; horizon a whole number of years 0–60 or null; monthly money in whole pence ≥ 0 or null; up to 20 exclusions, each ≤ 60, trimmed, blanks dropped, repeats (any case) kept once. Refusals are 400 with a `ProfileError` |
| `GET /trust-rules` | `TrustRulesView`: the user's trust settings, or `DEFAULT_TRUST_SETTINGS` until saved                                                                                                                                                                                       |
| `PUT /trust-rules` | `parseTrustSettings`: every number a whole number inside `TRUST_LIMITS`; publishers written any way (`https://www.Reuters.com/x`) become bare domains, must look like a domain, repeats dropped, 1–100 of them. Refusals are 400 with a `TrustRulesError`                  |

Stores follow the rules store: `dbProfileStore` / `dbTrustSettingsStore` read as the user (RLS) and save on the privileged connection; `memoryProfileStore` / `memoryTrustSettingsStore` in stub mode. No row means the empty profile or the defaults. The database's `CHECK`s repeat the limits.

### Trust rules and candidate nudges (`rules/trust.ts`, `nudges/candidates.ts`, Phase 5)

Both pure — no I/O, no clock — so a week gives the same answer when it's built and when it's re-checked after a rule changes. They decide what may be said; the research module (task 6) only writes the words.

**Trust rules** (`rules/trust.ts`):

- **Publisher identity** — `publisherKey(domain)` drops `www.` and trailing country/kind labels (`com`, `co`, `uk`, `org`, `net`, `io`, `news`, `info`, `ac`, `gov`) and keeps the organisation's label: `bbc.co.uk` and `bbc.com` are both `bbc`, `uk.finance.yahoo.com` is `yahoo`. Independent sources are distinct keys, so two BBC reports are one source. `domainMatches` accepts a named domain or its subdomains, never a lookalike (`notreuters.com`).
- **Stage A** (`stageA`, on reports): named publisher — in the user's list, **or the holding's own newsroom, for that holding only** (Waqar, 2026-09-17; from `COMPANY_FEEDS`) → inside the recency window (the user's days weekly, `DAILY_RECENCY_HOURS` 48 daily; nothing dated in the future) → no exclusion word in the headline or snippet. Kept reports are newest first; dropped ones carry the rule that dropped them.
- **Stage B** checks (each a `TrustCheck { rule, setting, passed, detail }`): `independent_sources` (≥ `minSources` distinct publishers, detail names them), `results_quiet` (no news nudge within `resultsQuietDays` of a results date either side; "No results date known" passes and says so), `cap_room` (always on: nothing on a Side Bet holding while the cap is broken), `exclusions` (whole word, any case).
- `basisFor(reports)` — "Based on N sources over M days" (distinct publishers, distinct UTC days). Never a percentage.

**Candidates** (`buildCandidates(input)`): from the rules evaluation, each holding's moves (day / week / month, percent and pence), linked reports, results dates and own newsroom domains, the user's trust settings and exclusions, and what's already been shown (`NudgeHistory`).

| Reason                    | Weekly                                                           | Daily                                           | Checks                                                   |
| ------------------------- | ---------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| `cap` (shape)             | Side Bet over its cap, with over-by and fix-it amounts           | Same, at most once in `CAP_DAILY_REPEAT_DAYS` 7 | exclusions ("Side Bet")                                  |
| `drift` (shape)           | Each drifted target                                              | —                                               | exclusions (pot name)                                    |
| `earnings` (calendar)     | Results within `CALENDAR_LEAD_DAYS` 7                            | Within 2, once per date                         | exclusions                                               |
| `isa_year_end` (calendar) | 5 April within `ISA_YEAR_END_LEAD_DAYS` 14, Foundation connected | Within 2, once                                  | exclusions ("ISA")                                       |
| `move` (awareness)        | The **week's** move at or past the pot's big-move line           | The **day's** move, once a day                  | cap room, exclusions                                     |
| `news` (awareness)        | Any report passing stage A                                       | — (weekly only, decision 4)                     | cap room, exclusions, results quiet, independent sources |

A candidate is shown when every check passes; `heldBackBy` is the first that didn't. Then budgets: **weekly**, awareness nudges past `weeklyBudget` are held back (`weekly_budget`), ranked by independent publishers, then newest report, then move size — shape and calendar never count and are never dropped. **Daily**, everything counts against what's left of `dailyBudgetPerDay` and `dailyBudgetPerWeek`, in order cap → results → ISA → moves (`daily_budget`). A weekly build with nothing shown adds a `none`/`quiet` candidate carrying the counts (holdings checked, reports read, reports counted, held back per rule) and the next dated thing (a results date or the ISA year end) — so a quiet week is a result with its working. Every candidate has a `dedupeKey` (`reason:subject:day-or-date`) for daily repeats.

### Rules on every screen (`rules/view.ts`, Phase 4)

Both read models call the engine the same way — each pot's investments + cash, connected unless `not_connected`, against the user's stored rules — and shape the answer through `rules/view.ts`: `rulesView` builds `/rules` (per-pot `status`, `judgedAgainstPercent`, `driftPoints`, `overBy`, a plain line; plus `settings`, `lastChangedAt`, `needsAttention`, `leftOut`, `fixIt`), and `ruleFlagFor` gives `/portfolio` buckets and `/buckets/:id` their `ruleStatus` and `overBy`. `/portfolio` carries `rulesNeedAttention` and the verdict ends "Side Bet needs a look." whenever the cap is broken. Stub mode judges the sample values the same way, with rules kept in memory. A test drives `/rules`, `/portfolio` and `/buckets/:id` through the real routes, over and under the cap, and requires identical results.

## Facts (`facts/`, Phase 5)

What's being said about what users hold, and what's coming up — collected on the refresh job's schedule into shared tables (`facts_news`, `facts_news_instruments`, `facts_events`), like prices. Nothing here decides anything; the trust rules and research module read what it stored.

- **Targets.** Everything anyone holds becomes a `FactsTarget` (`targets.ts`): **region** from the T212 ticker (`_US_EQ` US, `l_EQ` UK, `a`/`d`/`p`/`s`/`m`/`e` and BE/AT/PT EU, Kraken coins `global`), **asset** from the instrument type (`equity`/`etf`/`crypto`), and **aliases** computed from the name and ticker — legal words and share-class notes stripped ("Vanguard FTSE All-World (Dist)" → "Vanguard FTSE All-World"); names match as whole words in any case, tickers only in capitals and only at three letters or more. Aliases aren't stored; if one ever needs a hand-set override, that's a column then.
- **Adapters declare coverage** (`types.ts`): a holding adapter reads one holding at a time and states the regions and asset types it covers (plus an optional narrower `covers`); a feed adapter reads a general feed whose items are matched to holdings by alias; an events adapter reads dates for every holding it covers in one call. `adaptersFor(target, adapters)` is the whole selection rule. With the practice holdings: Nvidia ← Google News, Marketaux, Alpha Vantage, its own newsroom; ASML ← Google News, Marketaux, Alpha Vantage; Greggs and VWRL ← Google News, Marketaux; a coin ← Marketaux, Alpha Vantage; all of them also ← the general feeds.

| Adapter                                                                                                | Kind                                                      | Covers                                     | Every             | Daily budget                               |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------ | ----------------- | ------------------------------------------ |
| `google-news`                                                                                          | holding, by name, `"<name>" when:14d`                     | US/UK/EU/other equities and ETFs           | 12 h              | 300                                        |
| `marketaux`                                                                                            | holding, `NVDA` / `GRG.L` / `ASML` / `CC:BTC`, 3 articles | US/UK/EU equities, ETFs, crypto            | 20 h              | 80 (`MARKETAUX_API`)                       |
| `alpha-vantage` news                                                                                   | holding, relevance ≥ 0.5                                  | US/EU tickers, crypto `CRYPTO:BTC`         | 20 h, 1.5 s apart | 6, and only while 7 of prices' 22 are left |
| `alpha-vantage` events                                                                                 | `EARNINGS_CALENDAR` 3 months                              | US/EU equities by ticker (no London)       | 24 h              | 1, same sharing                            |
| `rss:company`                                                                                          | holding, company newsroom                                 | only companies in `COMPANY_FEEDS` (Nvidia) | 12 h              | —                                          |
| `rss:bbc-business`, `rss:investing-stock`, `rss:investing-crypto`, `rss:coindesk`, `rss:cointelegraph` | feed                                                      | matched by alias                           | 2 h               | —                                          |

- **Normalising.** Every report becomes one `facts_news` row keyed by sha-256 of its link with tracking parameters removed, so a report reached through two sources is stored once; holdings it mentions are linked (a holding adapter's own holding always is). Publisher domain comes from the item's own link or source (`www.` dropped) — trust rules match on it. Headlines ≤ 300, the source's own snippet ≤ 400, HTML and entities stripped; Google News titles lose their " - Publisher" suffix and get no snippet (its description only repeats the title). Investing.com's bare dates and Alpha Vantage's `20260916T213031` are read as UTC. General-feed items that mention no holding are kept unlinked.
- **Collecting** (`collectFacts`, a refresh-job step). For each read: due? (`facts_fetches`: last success older than the adapter's interval; after a failure, an hour) → budget (`takeCall` on `source_usage`, shared with market data; Alpha Vantage news and events also take from prices' `alpha-vantage` counter but only up to 15, leaving 7) → pause for sources that refuse bursts → read → record. A rate limit (`blocked`) isn't recorded as a failure, so the next run tries again. A failing source never stops the others. Sources are asked for 14 days back (the widest recency a user can set). Reports older than 90 days and results dates more than 90 days past are deleted each run.
- **Stub** (`stub.ts`): news and a results date relative to the moment asked. The **planted item**: Reuters and the FT on the same ASML story plus one unnamed site, inside 7 days — passes the default trust rules, held back at 3 sources. Nvidia gets one CNBC report, Bitcoin a CoinDesk report and an unnamed one, Greggs nothing; Nvidia reports results in 9 days.
- **Live** (`live.ts`): general feeds, Google News and company newsrooms always; Marketaux with `MARKETAUX_API`; Alpha Vantage news and results with `AV_ACCESS_KEY`.
- Tested on recorded responses (`fixtures/recorded/{google-news,rss,marketaux,alpha-vantage}`) and PGlite (dedupe across sources, alias linking, coverage selection, due and retry timing, rate limits, budgets incl. the share left for prices, bursts, clean-up). Run once against the dev database with the live sources (2026-09-17): 17 reads, none failed; 516 reports — Nvidia 172, ASML 108, Greggs 101, VWRL 23 — and ASML's results date.

## Your week (`nudges/`, Phase 5)

`nudges/service.ts` builds and reads weeks; `nudges/gather.ts` collects the input; `nudges/store.ts` is the log.

**Gathering** (`gather`) uses the same numbers the screens show: `ReadModel.portfolio(user, "day")` for pot values and which pots are connected → `evaluateRules` with the user's stored rules; `ReadModel.bucket` for each connected pot's holdings (cash rows skipped); `ReadModel.instrument(user, id, "month")` for each holding's price, value, today's change, provenance and a month of prices. Weekly and monthly moves (`moveSince`) are the price change from the last point at or before 7 / 30 days ago, in percent, and in pounds as today's value minus that value at the old price. Facts come from a `FactsReader`: `dbFactsReader` reads reports linked to the holdings from the last 14 days and every stored results date; `stubFactsReader` runs the stub adapters on the spot. A holding's own newsroom domain comes from `COMPANY_FEEDS`.

**Building** (`createNudgeService`):

- `buildWeekIfDue(user, now)` — due from 07:00 UTC on the week's Monday (London week), so a Monday missed while Render slept is built on the next run that week; the first build of a week stands (`digests` is unique per user and Monday). Candidates come from `buildCandidates` (trust rules and budgets). Words: every non-news nudge, and every held-back news nudge, gets Pip's template — no model call for something nobody sees; a shown news nudge goes to the writer with the user's plan only if `personal_research` is on. `NotMaterial` holds it back with a `not_material` check. When the writer cited fewer reports than it was given, `independent_sources` is checked again on the cited ones ("Cited: 1 publisher: Reuters") and can hold it back. If nothing ends up shown, a `none`/`quiet` nudge is added with the counts (including how many were held back after writing). The opening sentence is written from the shown titles. Everything — shown and held back — is saved in one transaction with its facts (plus cited ids, results dates, own newsroom domains and whether the cap was broken), checks, model, prompt version, whether it was personalised, the holding's price and source or the pot's share, the dedupe key and the London day.
- `buildDaily(user, now)` — the same pipeline with `cadence: daily` and the user's history (daily nudges shown today and this Monday-based week, the last shown cap nudge of any cadence, keys of daily nudges shown). `nudges_once_a_day` (unique user, cadence, dedupe key, day; migration 0015) makes a run every half hour log each nudge once a day.
- Known limit: budgets are applied before words, so a news nudge the writer holds back doesn't free its slot for the next one until the following build.

**Reading** (`week`, `thisWeek`): today's trust settings and exclusions are applied again to each nudge that was shown (`recheck`): news against its cited reports (named publishers, recency measured at build time, exclusions, independent sources, quiet around results, cap room as it was), big moves against today's line, shape and calendar against exclusions; then the weekly budget over what's left. A nudge that no longer passes moves to `heldBack`; a held-back one never comes back until the next build. With nothing left to show, the stored quiet nudge is shown, or one is made from the week's counts, saying the trust rules have changed since. `NudgeView` gives each nudge's sources (the cited reports: publisher, headline, link, date — never article text), every check in plain words, `heldBackBecause` ("Not enough different publishers — 1 publisher: Investing.com") and the user's response. `today` is shown daily nudges from today that still pass.

**Routes** (`routes/week.ts`, behind the guard): `GET /week` → `WeekResponse { week, today, pastWeeks }`; `GET /week/:weekOf` (400 for a non-date, 404 for no such week); `POST /nudges/:id/response` `{ response: nothing|acted|dismissed }` → 400 for anything else, 404 unless it's the caller's own nudge (`respond` updates only rows with their user id).

**Stores**: `dbNudgeStore` — reads as the user (RLS), writes on the privileged connection; `memoryNudgeStore` for stub mode. **Stub mode** (`app.ts`) builds a week on read from the sample data, stub facts and the stub writer — the sample's broken cap, Apple's weekly move and the planted ASML story shown; Nvidia (one publisher) and Bitcoin (Side Bet over its cap) held back.

**The loop, tested end to end** (task 11): `nudges/loop.test.ts` drives the real routes in stub mode with a fixed Monday-morning clock (`createNudgeService(..., { now })`) — the planted ASML story passes the trust rules and is in `GET /week` and the log (model, prompt version, its two reports); `PUT /trust-rules` with three publishers required takes it off the week at once, held back with its reason, while the log keeps it as built; putting the rule back brings it back; an exclusion saved through `PUT /profile` does the same; the sample's broken cap stays throughout. `apps/web/src/screens/loop.test.tsx` does the screen side: story on Your week → slider moved and saved on Rules → Your week refetched, story gone, reason one tap away.

**Job step 6** (`refresh-job.ts`): for each allowlisted user with a live account and a linked sign-in, build the week if due, then daily nudges from 07:00 UTC; one person's failure is recorded (`nudges:<user>`) and the rest carry on. `server.ts` wires the database stores, `dbFactsReader`, and the Groq writer when `LLM_MODE=groq` (stub writer otherwise).

**Outcomes** (`nudges/outcomes.ts`, job step 7): once a nudge is 7 (then 30) days old, `fillOutcomes` records a holding's price that many days after its build day — the cached close on or before that day (no older than 5 days), converted at that day's FX close to pence of pounds per unit, the same basis as `price_at` — or, for a shape nudge, the pot's share of invested value that day from `daily_values` (investments only, so it can differ slightly from the share at build, which counted cash). `price_7d_at` / `price_30d_at` mark each done; nudges with nothing to measure (ISA year end, quiet weeks) are marked done straight away, and ones whose closes still aren't cached 14 days after they were due are given up on. Never a new call, never an LLM, and nothing on screen reads them yet.

Checked against the dev database with a dry run (built in memory, nothing saved, 2026-09-17): 4 holdings, 380 reports read, 91 counted; shown — Foundation drifted (only the ISA has value), Nvidia news (9 publishers), Greggs news (BBC and Yahoo Finance UK), ASML's weekly move and ASML news; held back — Nvidia's move (over the weekly limit) and VWRL news (one publisher).

## Research (`research/`, Phase 5)

Where words come from. **Handed values, hands back text** — nothing else (hard line 2, decision 9).

- **The wall.** `research/` imports only its own files and `@finance-app/shared`, and its code never touches `fetch`, `process`, `require`, `globalThis`, `eval` or the filesystem. `research/wall.test.ts` proves it: it lists every import in every non-test file with the TypeScript compiler (`ts.preProcessFile`, dynamic imports included), resolves relative ones and fails on anything leaving `research/` or any package but the shared one; scans code (comments stripped) for the forbidden globals; fails if it finds no files; and checks itself against a planted crossing. ESLint (`eslint.config.js`) flags the same in the editor: imports naming the rest of the API, other packages, and the `fetch`/`process` globals. So there's no path from an LLM to rules, keys, the database, providers or orders.
- **The LLM is injected.** `Chat` (`types.ts`) is a function `{ model, system, user, schema } → { content, model }`. The only network implementation is `nudges/groq-chat.ts` (`groqChat`): Groq's OpenAI-compatible chat completions, strict `json_schema`, `reasoning_effort: low`, temperature 0.2, 30 s timeout; any failure is `LlmUnavailableError` with a reason and never the key. Zero Data Retention is on in Groq's console.
- **Writers** (`writer.ts`), both `NudgeWriter { news(input), opening(titles) }`:
  - `llmWriter({ chat, model })` — a news nudge goes to the model **only when the input has a plan** (personal research on); otherwise Pip's template, and no call. The answer goes through the guard; a failure (unreachable, schema, bad citation, banned words) returns the template and reports why through `onFallback`. `material: false` comes back as `NotMaterial` for the build to hold the nudge back. Cited numbers become report ids. The week's opening sentence works the same way, falling back to "Here's your week."
  - `stubWriter()` — stub mode and CI: canned words from the facts, always material, citing every report. No network.
- **What reaches the model** (`prompts/awareness.v2.ts`; v2 adds "say who made each claim" and "state only what the reports say" to v1, which stays in `awareness.v1.ts` for nudges logged with it): the plan (goals, horizon, risk words, shape in percent), the holding's name, ticker, pot, pot share, price moves **in percent**, next results date, and numbered reports (publisher, date, headline, snippet) with angle brackets stripped so a headline can't close its block. **Never** pounds, quantities, emails or ids. `week.v1` gets only the week's titles.
- **The guard** (`guard.ts`): JSON must match; title ≤ 80, body ≤ 320, opening ≤ 140; every cited number must be one it was given, at least one; and no banned wording — buy/sell/sold, hold-as-advice phrases, should, recommend, price targets, "will rise/fall…", "expect the price", under/overvalued, cheap/expensive/bargain, guarantee, benefit/good for/opportunity/upside, the design's banned jargon, and **any percentage** (the model is never given pounds, so it can't put money first — Pip shows figures itself).
- **Pip's own sentences** (`templates.ts`, `TemplateFacts` kept in step with the candidates' facts by a compile-time test): cap (over by in pounds, both fix-it amounts, "You'd do either at your broker"), drift, results date ("a date on the calendar, not a prediction"), ISA year end, big move (pounds first, then the percent and the user's line), news ("N reports from named publishers: …" — the general wording for everyone without personal research, never "worth a look"), and the quiet week (holdings checked, reports read, how many didn't get past the trust rules, next on the calendar).
- **Config**: `LLM_MODE` `stub` (default) or `groq` (needs `GROQ_API_KEY`); `LLM_MODEL` defaults to `openai/gpt-oss-120b`. Anything else, Ollama included, stops the server at startup.
- Tested with recorded Groq answers (the "benefit a long-term holder" answer is thrown out) and fakes. Run against Groq (2026-09-17): v1 and v2 drafts and an opening sentence all passed the guard, 0.3–0.8 s each; v2 drafts attributed claims ("Reuters reports…, according to JPMorgan").

## Market data layer

`apps/api/src/market/market.ts` is the other provider interface, and it answers a different question: _what is it worth, and what has it done?_ Trading providers only ever answer _what is held, and how much cash?_ Keeping the two apart is how hard line 8 stays true — every price and every chart in the app comes from here, and nothing reads a price from a trading API.

```ts
interface MarketData {
  readonly source: string; // named in the provenance line
  getPrice(instrumentId: string): Promise<Pence>;
  getSeries(instrumentId: string, range: PriceRange): Promise<SeriesPoint[]>;
  getFreshness(bucket: Bucket): Promise<PriceFreshness>;
}
```

`getFreshness` is per pot, not global, because the staleness ladder names the affected pot ("Side Bet is 2 hours old") and because different pots get different sources from Phase 3 on.

`market/stub` is the only implementation so far. It generates prices from a small deterministic PRNG seeded by the instrument id, so the same holding always draws the same chart and fixtures, tests and screenshots agree. It also takes per-pot staleness overrides — an age in hours, an outright failure, or markets-closed — which is how the green/amber/red ladder gets exercised end to end without a real feed ever having to break. It also takes per-holding **series anchors** (`market/stub/anchors.ts`, built from the stub positions and fixtures in `app.ts` and `server.ts`): the "All" series starts at the average price paid and the "Day" series at this morning's price, the walk blending between its two ends. Without them an invented chart captioned "since you bought" could contradict "+24% since you bought" beside it. `server.ts` reads them from `STUB_STALENESS` (`market/stub/staleness-env.ts`), so the dev server can be put on any rung.

### Real sources (Phase 2, `market/sources/`)

The stub above still drives stub mode. Real prices come from two sources behind one small interface, `PriceSource` — `quote(target)` and `dailyCloses(target, from)` — where a target is a listing (by that source's symbol, plus T212's currency for it) or GBP→USD/EUR. Prices stay in the listing's currency here; pence and FX happen when a holding is valued.

- **`yahoo.ts`** — the unofficial chart endpoint, primary (Waqar's call; against Yahoo's terms; re-decided before anyone else uses Pip). One call gives the quote and today's 5-minute points. Daily closes are keyed by the exchange's own calendar day. `GBp` becomes `GBX`. A 429 is `blocked`, an unknown symbol `not_found`.
- **`alpha-vantage.ts`** — the free tier, fallback: `GLOBAL_QUOTE`, `CURRENCY_EXCHANGE_RATE`, `TIME_SERIES_DAILY` / `FX_DAILY` compact (100 trading days). No intraday; latest data is the previous trading day, stamped at 21:00 UTC that day. AV never says a listing's currency, so the instrument's T212 currency is used. Its 200-with-a-message rate limit is `blocked`, and the key never appears in an error.
- **`fallback.ts`** — `withFallback` asks each source in order (skipping one with no symbol for the target) and returns the answer **with the source that gave it**, so the provenance line always names the source a price really came from.
- **`hours.ts`** — "is this market open" from T212's working schedules: open from an `OPEN` event until the next event of any kind, so US pre-market, after-hours and overnight don't count, and a holiday (no `OPEN`) is closed. `scheduleCovers` says when the published schedule has run out rather than guessing.
- **`coingecko.ts`** (Phase 3) — crypto, primary; Demo key in `x-cg-demo-api-key`, target symbol is the CoinGecko coin id. `quote` reads the last 24 h of ~5-minute points: the newest is the price, the last point at or before 00:00 UTC (of the newest point's day) is yesterday's close, later points are today's chart — crypto never closes, so "today" is the UTC day. `dailyCloses` uses `interval=daily`, whose points are stamped 00:00 UTC with the previous day's close; anything more than 365 days back is refused as `unsupported` without a call, so the fallback asks Kraken. `krakenCoinIds` maps Kraken asset names to coin ids from CoinGecko's list of Kraken's markets.
- **`kraken-public.ts`** (Phase 3) — crypto fallback: Kraken's keyless public `Ticker` (last trade; today's open as yesterday's close; stamped when fetched) and daily `OHLC` (latest 720 candles, today's unfinished candle dropped). Only pounds pairs (`XBTGBP`); a coin with no pounds pair isn't priced here.
- Tests replay `fixtures/recorded/{yahoo,alpha-vantage,coingecko,kraken}` and T212's recorded schedules; both sources were also run live once (Yahoo quote, intraday, daily closes, FX; Alpha Vantage answering as the fallback).

### The shared price cache (`market/refresh.ts`, `budget.ts`, `live.ts`)

- **One refresh per instrument or FX pair for everyone**, on the privileged connection, into `prices`, `intraday_series` and `daily_closes`. Read routes (refresh-on-read) and the scheduled job both call `refreshDue(db, market, instrumentIds)`; whoever gets there first does the work.
- **When a price is due** (`isDue`): nothing cached → now. Market open (T212 schedule) → every 15 min. Market closed → once after the close, then nothing until it opens. Schedule unknown or run out → hourly. FX → every 30 min. Crypto (`type` `CRYPTO`) → every 15 min, any hour, any day. After a failure → leave it 5 min.
- **Failures never throw out of a refresh.** The last good price stays; `last_failed_at` is set (a placeholder row with an empty `source` if there was never a price — `cachedPrices` ignores those), and the staleness ladder reports the real age.
- **FX** pairs are refreshed for whatever currencies the instruments need (USD, EUR; GBP and GBX need none).
- **`ensureDailyCloses`** fetches only the missing part of an instrument's or pair's daily history, for backfill and longer charts.
- **Daily call budgets** (`withBudget`) are counted atomically in `source_usage` — a single upsert that only increments while under the limit — so concurrent refreshes can't overspend: Alpha Vantage 22/day (of its 25), Yahoo 1,500/day, CoinGecko 300/day (its Demo plan allows 10k a month), Kraken public 1,000/day. Over budget, the source reports itself `blocked` and the fallback moves on.
- **`liveMarket(db, { alphaVantageKey, coinGeckoKey })`** builds, with budgets and each instrument's own symbols: Yahoo → Alpha Vantage for stocks and FX, CoinGecko → Kraken public for crypto. A missing key just removes that source.
- `market_schedules` stores T212's working schedules per schedule id (saved when a credential polls metadata; shared, readable when signed in).
- Tested on PGlite: refresh timing, once-only refresh, fallback source naming, last-good-price on failure, budget exhaustion, and daily-close gap filling.

## Auth

Supabase Auth, emailed magic links for now (Google later), proves someone owns an email. A row in our own `users` table is what lets them in (CLAUDE.md s3, hard line 4). Sign-in itself happens between the browser and Supabase; the API never sees a password or an OAuth callback.

**Verifying a token** (`auth/jwt.ts`). Every request carries `Authorization: Bearer <Supabase access token>`. The API checks its signature against the project's published signing keys (JWKS, via `jose`), and checks the issuer (`<SUPABASE_URL>/auth/v1`) and audience (`authenticated`), so a token from another Supabase project, or one not issued to a signed-in user, is refused. Only asymmetric algorithms are accepted. The API holds no Supabase secret at all — just the project URL.

**Two walls, in order** (`auth/guard.ts`):

| Check                       | Refusal               |
| --------------------------- | --------------------- |
| A valid token               | `401 unauthenticated` |
| That email on the allowlist | `403 not_on_the_list` |

`/health` needs neither. `/me` and `/waitlist` need a valid token but not the allowlist, because someone who has just been refused has to be able to find that out and ask to be let in. Every other route needs both.

The guard is an `onRequest` hook on the root instance — deliberately not added via `register`, which would encapsulate it into a child scope and quietly leave sibling routes open. It runs before every route, including ones added later, so **a route is protected by existing**. `buildApp()` with no verifier refuses everyone: a misconfigured server fails closed. The allowlist is checked on every request, not once at sign-in, so removing someone takes effect immediately.

`guard.test.ts` enforces this rather than trusting it: it walks the app's real route table and asserts every route except `/health` answers 401 without a token. An unprotected route added later fails the suite without anyone adding a case, and the test fails rather than passing vacuously if the table is ever empty.

**`/me`** tells a signed-in person whether they're allowed in, and links their allowlist row to their Supabase identity (`auth_user_id`) the first time they arrive.

**The waitlist.** Someone refused is still signed in to Supabase, so `POST /waitlist` is an ordinary authenticated request. The address comes from their verified token, never the request body, so nobody can put someone else's email on the list. Asking twice keeps the first ask. Being on it grants nothing.

**Sessions** are Supabase's: a short-lived access token (an hour by default), refreshed by the client. The 12-hour-idle and 7-day caps from the original plan need a paid Supabase plan, so they aren't applied.

**Testability.** `TokenVerifier`, `AllowlistStore` and `WaitlistStore` are all interfaces. `jwt.test.ts` verifies real ES256 signatures from a key generated for the test run; route tests use `test-support/auth.ts`, whose verifier recognises tokens it hands out. No Supabase project, no database, no network.

**Admin.** `pnpm --filter api allowlist <list|add|remove> [email]` is the only way to grant access. **Sign-ups are off in Supabase** and the web app asks for links with `shouldCreateUser: false`, so nobody can make themselves a Supabase account: `add` also makes the person's confirmed Supabase account through the admin API (`auth/supabase-admin.ts`, `SUPABASE_SERVICE_ROLE_KEY` from `apps/api/.env`, refuses to run on Render). A sign-in request for an address with no account is answered like any other, so the sign-in screen never reveals who's on the list. `allowlist personal <email> on|off` turns personalised research on for someone (Phase 5); nothing in the API can.

**In the browser.** Screens never import Supabase. `lib/auth-client.ts` wraps it in a four-method `AuthClient` (get session, listen for changes, send a magic link, sign out). `sendMagicLink` calls `signInWithOtp` with `emailRedirectTo` set to the app's origin and `shouldCreateUser: false` (Supabase's "sign-ups not allowed" answer is treated as sent), and turns Supabase's send-limit error into `TooManyEmailsError`; `shell/auth-provider.tsx` holds the signed-in state and gives the API client a token getter. The token is read fresh on every request, so one Supabase has just refreshed is always the one sent. `RequireSession` routes by the two walls: no session → `/sign-in`; a session → ask `GET /me`; not allowed → `/not-on-the-list`; allowed → the app. If the API rejects a session the browser still holds (revoked, or expired past refreshing), the browser signs it out rather than redirecting — the sign-in screen would otherwise see a session and send you straight back, forever. Two details keep that from looping: the provider's sign-in and sign-out functions are stable for the life of the client, and a session update that changes nothing hands back the same state object. Tests use `test/fake-auth.ts` instead of Supabase.

**Env vars** (see `.env.example`): `SUPABASE_URL` for the API — the server won't start without it. The web app needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; without them it shows "Pip isn't configured" rather than a blank page. The publishable key is public by design — which is exactly why every table has RLS on.

## Signing in locally without email

`pnpm --filter api sign-in-link [email]` (`src/dev/sign-in-link.ts`) asks Supabase's admin API for a one-time magic link back to `http://localhost:5173` — no email sent, so no rate limit. Authentication is unchanged: the link signs the browser in through Supabase like an emailed one, and the API still verifies every request and checks the allowlist. There is deliberately no "skip sign-in" switch or test email that bypasses it (hard line 4). The script needs `SUPABASE_SERVICE_ROLE_KEY` in `apps/api/.env` only, refuses to run with `NODE_ENV=production` or on Render, and only redirects to localhost.

## Deploy (Render, Phase 2)

One **Render free web service**, `pip` — https://pip-old.example.net — in Frankfurt (nearest to Supabase's eu-west-1), deploying `main` automatically on every push.

- **Build:** `pnpm install --frozen-lockfile`, then `web` build (needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time), then `api` build.
- **Start:** `cd apps/api && node --import tsx dist/server.js`. `tsx` is a runtime dependency because `@finance-app/shared` is TypeScript source; plain Node can't resolve it.
- **One origin** (`web.ts`): with `WEB_DIST_DIR=../web/dist`, Fastify's `rewriteUrl` sends `/api/*` to the API's own routes and everything else to `/app/*`, served from the built app — a real file, or `index.html` so a reload of `/rules` works. Fingerprinted `assets/` are cached for a year as immutable; `index.html` is `no-cache`; the shell gets `nosniff`, `same-origin` referrer and `DENY` framing. The static app is public (sign-in screen and code, no data); the guard exempts `/app/*` only when serving it. Health check: `/api/health`.
- **Non-secret env** set on the service: `NODE_VERSION=24`, `NODE_ENV=production`, `PROVIDER_MODE=t212`, `T212_ENV=demo`, `WEB_DIST_DIR`, `LOG_LEVEL`, `MASTER_KEY_VERSION`, `SUPABASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`.
- **Secrets, set only in Render's dashboard** (never through chat or git): `DATABASE_URL`, `MASTER_KEY`, `JOB_SECRET`, `AV_ACCESS_KEY`, `COINGECKO_KEY` (Phase 3), `MARKETAUX_API`, `GROQ_API_KEY` (Phase 5), with `LLM_MODE=groq` set alongside. The dev and production app share the one Supabase project, so `MASTER_KEY` must be the same key that sealed the stored credentials. `JOB_SECRET` must match the `private.job_settings` row, which already points `pg_cron` at `https://pip-old.example.net/api/jobs/refresh`.
- **Supabase Auth** must list `https://pip-old.example.net` in its redirect URLs, or magic links sign into the wrong place.
- **Free hours are shared** across the Render workspace (750/month). The scheduled refresh runs only in weekday market hours so Pip sleeps otherwise; other services in the workspace draw on the same hours.

## Storage

Postgres via Drizzle ORM, on Supabase. Single `DATABASE_URL` env var, nothing else host-specific (CLAUDE.md s3; never Render's free Postgres, it expires after 30 days).

- **The database is hosted in every environment** — on Supabase, with a separate project for development (`pip`, eu-west-1). No local Postgres, no Docker. The server connects through the **session pooler** (port 5432), which suits a long-running process. Nothing in the test suite or CI ever talks to it.
- `apps/api/drizzle/` — migration SQL, committed. `pnpm --filter api db:generate` writes one from the schema; hand-written SQL (RLS, policies, grants, functions) uses `drizzle-kit generate --custom`. `db:migrate` applies them; they're applied to the dev project.
- `apps/api/src/db/client.ts` — `getDb()` is a lazy singleton on the privileged connection. No socket opens until a caller queries; nothing in tests or CI calls it.

**Tables** (`src/db/schema.ts`). Money in pence of pounds is `bigint`; provider prices and quantities keep full precision as `numeric` and become pence only at the edge.

| Table                    | What                                                                                                                                                                                                                                                                                                                                                                                                    | Who can read it (as `authenticated`)                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `users`                  | **The allowlist** — email, name, `personal_research` (Phase 5: personalised nudges, off by default, set only by the CLI), `auth_user_id` (links to Supabase `auth.users` on first sign-in; a plain uuid, so migrations never touch Supabase's `auth` schema)                                                                                                                                            | nobody — server only                                                  |
| `waitlist`               | Refused sign-ins, address from the verified token only                                                                                                                                                                                                                                                                                                                                                  | nobody — server only                                                  |
| `provider_credentials`   | One row per user + provider + account kind (`isa`/`invest`): sealed key and secret, key version, status, account currency, last verified/polled, backfill status, history start                                                                                                                                                                                                                         | own rows, **status columns only** — the sealed columns aren't granted |
| `holdings`               | Latest poll per credential: instrument, quantity, staked part (Kraken), average price paid and total cost in pence — both null until known (a Kraken coin before its history is rebuilt; screens then say "since bought" is unavailable)                                                                                                                                                                | own rows                                                              |
| `cash`                   | Latest poll per credential, in pence                                                                                                                                                                                                                                                                                                                                                                    | own rows                                                              |
| `trades`                 | Filled orders from provider history, keyed by fill id so re-reading never double-counts                                                                                                                                                                                                                                                                                                                 | own rows                                                              |
| `kraken_ledger`          | Kraken ledger entries per credential (asset, type, amount, fee, balance after), keyed by Kraken's entry id so re-reading never doubles — for rebuilding Side Bet history and cost (Phase 3)                                                                                                                                                                                                             | own rows                                                              |
| `user_rules`             | A user's shape: Handpicked target and Side Bet cap in whole percent (Foundation is the rest), `updated_at`; no row means 70/25/5. `CHECK`s mirror the API's limits (Phase 4)                                                                                                                                                                                                                            | own row                                                               |
| `facts_news`             | News reports from any source (Google News, Alpha Vantage, Marketaux, RSS), keyed by a hash of the link so one report reached twice is stored once: source, publisher and its domain, headline (≤ 300), the source's own snippet (≤ 400), link, published time. The article itself is never copied (Phase 5)                                                                                             | allowlisted users only (Supabase session + allowlist row)             |
| `facts_news_instruments` | Which holdings a report is about — none, one or several                                                                                                                                                                                                                                                                                                                                                 | allowlisted users only (Supabase session + allowlist row)             |
| `facts_events`           | Results dates per instrument (`kind` `earnings`), with source extras                                                                                                                                                                                                                                                                                                                                    | allowlisted users only (Supabase session + allowlist row)             |
| `facts_fetches`          | When each fact source last read each target (instrument or feed), and last failure — the collector's "what's due"                                                                                                                                                                                                                                                                                       | nobody — server only                                                  |
| `user_profiles`          | Goals, horizon, monthly money in (pence), risk in their words, up to 20 exclusions; no row means empty. `CHECK`s mirror the API's limits                                                                                                                                                                                                                                                                | own row                                                               |
| `trust_settings`         | Named publisher domains, recency, independent sources, results quiet days, weekly and daily budgets, big-move percent per pot; no row means `DEFAULT_TRUST_SETTINGS`. `CHECK`s mirror `TRUST_LIMITS`                                                                                                                                                                                                    | own row                                                               |
| `digests`                | One user's week, keyed by its Monday (a `CHECK`): opening sentence, counts of what the build looked at                                                                                                                                                                                                                                                                                                  | own rows                                                              |
| `nudges`                 | The nudge log (dedupe key + London build day unique per user and cadence, migration 0015): cadence (a weekly nudge must belong to a week, a daily one mustn't), kind and reason (pairs checked), pot, holding, title, body, basis, frozen facts, trust checks, shown or held back, model, prompt version, personalised; what the user did; price and pot share at the time, +7d and +30d (filled later) | own rows                                                              |
| `daily_values`           | Each pot's value and cost at each day's close (`backfill` or `snapshot`)                                                                                                                                                                                                                                                                                                                                | own rows                                                              |
| `instruments`            | Keyed by **T212 ticker** (ISINs aren't unique across listings); ISIN, name, currency incl. GBX, working schedule, Yahoo / Alpha Vantage symbols (+ override flag); for crypto, CoinGecko id and Kraken pounds pair                                                                                                                                                                                      | allowlisted users only (Supabase session + allowlist row)             |
| `prices`                 | Latest price per instrument or `FX:<pair>`, previous close, source, as-of, last failure                                                                                                                                                                                                                                                                                                                 | allowlisted users only (Supabase session + allowlist row)             |
| `daily_closes`           | Daily closes per instrument or FX pair                                                                                                                                                                                                                                                                                                                                                                  | allowlisted users only (Supabase session + allowlist row)             |
| `intraday_series`        | Today's points per instrument, for the Day chart                                                                                                                                                                                                                                                                                                                                                        | allowlisted users only (Supabase session + allowlist row)             |
| `source_usage`           | Calls per market-data source per day, for call budgets                                                                                                                                                                                                                                                                                                                                                  | nobody — server only                                                  |

**Limits live twice, from one source.** `drizzle-kit` can't load the shared package's TypeScript, so `schema.ts` keeps copies of the Phase 5 limits and allowed values (`DB_TRUST_LIMITS`, `DB_NUDGE_REASONS`…) for its `CHECK`s; `db/research-schema.test.ts` fails if they differ from `@finance-app/shared`.

**Row Level Security is on for every table** (`0001`, `0003`, `0013`). The web app ships Supabase's public key and Supabase's REST API exposes `public` tables to it, so a table without RLS would be readable by anyone.

- **Signed-in users only ever read.** All grants to `anon` and `authenticated` are revoked, then `SELECT` is granted back where the table above says so. Every write goes through the server's privileged connection.
- **Shared tables** (instruments, prices, closes, intraday series, schedules, facts) need an allowlist row too: their policies are `private.current_app_user_id() IS NOT NULL` (`0014`), because `instruments` only holds what someone has held. `users` and `waitlist` grant nothing to `anon` or `authenticated` — Supabase's default grants were revoked in `0014`. Probed on the dev database: Waqar reads them; a session with no allowlist row reads nothing.
- **"Own rows"** means `user_id = private.current_app_user_id()`: a `SECURITY DEFINER` function mapping `auth.uid()` to the caller's allowlist row. It lives in a `private` schema (`0004`) because Supabase exposes `public` functions over REST.
- **Checked twice.** `db/rls.test.ts` reads the migrations and fails if a table lacks RLS, a user-owned table (any table with `user_id`) lacks an own-rows policy using the private helper, or the sealed credential columns are ever granted. And the policies were probed on the dev database as two throwaway users in a rolled-back transaction: each saw only their own rows; sealed columns, writes and `source_usage` were refused; shared instruments were visible. Supabase's security advisor reports nothing beyond the intended "RLS enabled, no policy" on the server-only tables.

**Reading as the user** (`db/user-scope.ts`). User-facing reads run inside `asUser(db, authUserId, work)`: one transaction that sets the verified Supabase user id as `request.jwt.claims` and `SET LOCAL ROLE authenticated`, so the policies above decide what `work` can see. Both settings are transaction-local, so nothing leaks into the next request on a pooled connection. `authUserId` always comes from the verified token (`request.authUser`), and `asUser` refuses anything that isn't a uuid. The guard links an allowlist row to its Supabase identity on first contact (not only on `/me`), because the policies find a user's rows through that link — an unlinked user sees nothing. Scheduled jobs and credential writes use the privileged connection directly.

**Testing RLS without a network.** `test-support/pglite.ts` starts an in-process Postgres (PGlite), recreates the bits of Supabase the migrations rely on (`anon`, `authenticated`, `auth.uid()`), and applies every real migration in journal order. `db/user-scope.test.ts` seeds two users and proves — below the route layer, with queries that have no `where` clause — that each sees only their own rows, can't read sealed columns, can't write, can read shared market data, and that the role doesn't survive the transaction. `asUser` was also checked against the Supabase dev project through the session pooler.

Auth and route tests otherwise use in-memory stores, and CI never talks to Supabase.

## Env flags

| Var                                                  | Purpose                                                                                                                                                                                | Default                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `PROVIDER_MODE`                                      | `stub` (fake data) or `t212` (real providers: Trading 212 from Phase 2, Kraken from Phase 3 — the name predates Kraken). `t212` needs `MASTER_KEY` (and `T212_ENV=demo` until Phase 7) | `stub`                                      |
| `MASTER_KEY`                                         | 32 random bytes, base64 — seals provider keys. **Render only**; never in Supabase, git or chat. `pnpm --filter api master-key` makes one                                               | none — required for `t212`                  |
| `MASTER_KEY_VERSION`                                 | Which version `MASTER_KEY` is; stamped on every sealed value                                                                                                                           | `1`                                         |
| `MASTER_KEY_PREVIOUS`, `MASTER_KEY_PREVIOUS_VERSION` | Only during a rotation: the old key, so old values can be opened and re-sealed                                                                                                         | none                                        |
| `JOB_SECRET`                                         | Shared secret the scheduler sends as `x-job-secret` to `POST /jobs/refresh`. Render only, plus the `private.job_settings` row                                                          | none — job routes refuse everyone           |
| `WEB_DIST_DIR`                                       | Production only: the built web app to serve from the same origin, with the API under `/api`                                                                                            | none — API only (dev uses Vite)             |
| `LOG_LEVEL`                                          | pino level for the server                                                                                                                                                              | `info`                                      |
| `DATABASE_URL`                                       | Postgres connection string                                                                                                                                                             | none — required once a route touches the DB |
| `PORT`                                               | apps/api listen port                                                                                                                                                                   | `3001`                                      |
| `LLM_MODE`                                           | Who writes nudges: `stub` (canned, no network) or `groq`                                                                                                                               | `stub`                                      |
| `LLM_MODEL`                                          | The Groq model                                                                                                                                                                         | `openai/gpt-oss-120b`                       |
| `GROQ_API_KEY`                                       | Groq key, needed for `LLM_MODE=groq`. Render and local `.env` only                                                                                                                     | none                                        |
| `MARKETAUX_API`                                      | Marketaux free key — news for Phase 5 facts. Render only in production                                                                                                                 | none — Marketaux left out                   |
| `STUB_STALENESS`                                     | Stub only: force the staleness ladder, e.g. `Degen:2` (amber), `Degen:failed` (red), `all:closed`. Unreadable values stop the server at startup                                        | empty — everything fresh                    |

Provider keys are never server env vars in a deployed Pip: each user's keys are sealed per user in Postgres (below). `T212_API_KEY`/`T212_API_SECRET` in a local `apps/api/.env` exist only for developer verification against a practice account (Phase 2 task 1), and are never read by the server.

## Key encryption

`crypto/secrets.ts` is the only code that seals or opens a provider key (CLAUDE.md s3 "Key storage", hard line 6).

- **AES-256-GCM** with `MASTER_KEY`, a fresh random 12-byte IV per value, and the 16-byte auth tag stored alongside. Stored form: `pip:<keyVersion>:<iv>:<tag>:<ciphertext>` (base64url parts).
- **Bound to where it belongs.** Every seal and open takes a context — `user:<id>|<provider>|<account kind>|key` or `…|secret` — passed to GCM as additional data. A value copied into another user's row, or from the key column to the secret column, fails to open instead of decrypting as someone else's credential.
- **Where the halves live.** Ciphertext in Supabase; `MASTER_KEY` only in Render's environment. Reading a broker key needs both. Opening happens in Fastify's memory for the moment of a provider call; nothing returns plaintext to a client, and failures say only "Could not open sealed value".
- **Startup.** `config.ts` refuses `PROVIDER_MODE=t212` without a valid `MASTER_KEY` (32 bytes, base64); error messages never echo the key.
- **Logging.** The server's pino logger redacts auth and job-secret headers and any `key`, `secret`, `apiKey`, `apiSecret`, `password`, `accessToken` or `masterKey` field (`logging.ts`); a test logs real-looking values and checks none reach the output. Fastify's default request serializer logs no headers or bodies in the first place.

**Losing `MASTER_KEY`** makes every stored key unreadable. Nothing else is lost: users re-paste their keys (they're read-only until Phase 8). Keep a copy somewhere safe outside Render and Supabase — a password manager.

### Rotating `MASTER_KEY` (runbook)

1. Generate a new key: `pnpm --filter api master-key`. Don't paste it anywhere but the next step.
2. In Render, set `MASTER_KEY_PREVIOUS` = the current `MASTER_KEY`, `MASTER_KEY_PREVIOUS_VERSION` = the current `MASTER_KEY_VERSION`, then `MASTER_KEY` = the new key and `MASTER_KEY_VERSION` = current + 1. Deploy. New seals use the new key; old values still open.
3. Re-seal every stored credential: `pnpm --filter api reseal-keys` (with both keys set). It opens each credential still on an older version and seals it with the new key, row by row; rerunning is harmless, and it prints counts only. It exits non-zero if any row couldn't be opened.
4. Confirm nothing is stale, then remove `MASTER_KEY_PREVIOUS` and `MASTER_KEY_PREVIOUS_VERSION` and deploy.
5. Update the offline copy of the key.

Never delete the old key before step 4 — anything still sealed with it becomes unreadable.

## How stub mode works

`StubProvider` is instantiated per bucket and returns constant fake positions/cash/history. It has no network calls, no filesystem access, no DB access — safe for unit tests and CI. `PROVIDER_MODE=stub` is the default locally and in CI; the deployed service runs `PROVIDER_MODE=t212` against the practice account. CI never touches a provider, market-data source or database: Trading 212, Yahoo and Alpha Vantage are replayed from `fixtures/recorded/`, and database tests run on PGlite.

## Testing

Vitest in all three packages (`apps/web`, `apps/api`, `packages/shared`). `apps/web` additionally uses Testing Library + jsdom for component tests. `apps/api/vitest.config.ts` excludes `dist/`: `pnpm build` emits compiled output there, and vitest's default include would otherwise collect it, running every suite twice — the second time against whatever was last compiled. `pnpm test` from the root runs all three via `pnpm -r test`. `apps/api/src/fixtures/consistency.test.ts` checks the sample data agrees with itself — percentages against pounds, since-you-bought against the price paid, value against market price, chart ends against their anchors — because stub numbers are still numbers someone reads. CI (`.github/workflows/ci.yml`) runs lint, format check, test, and build on every push to `main` and every PR, entirely in stub mode with no secrets configured.
