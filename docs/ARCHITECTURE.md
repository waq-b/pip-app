# Architecture

Living doc. Reflects what's actually built, not what's planned — check `docs/phases/phase-N.md` for what's coming. Last updated: Phase 1, through the stub API.

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
│           │   └── schema.ts   ← users (the allowlist), waitlist
│           ├── fixtures/   ← the design's sample words and numbers
│           ├── market/     ← MARKET DATA: what it's worth, what it's done
│           │   ├── market.ts   ← common market-data interface
│           │   └── stub/       ← deterministic fake prices
│           ├── providers/  ← TRADING: what is held, how much cash
│           │   ├── provider.ts ← common trading-provider interface
│           │   └── stub/       ← fake holdings, used in tests and Phase 0/1
│           └── routes/     ← read routes composing the two layers
└── packages/
    └── shared/              ← types shared between web and api
        └── src/
            ├── buckets.ts    ← BUCKETS, Bucket, BUCKET_META (display names)
            └── api.ts        ← response types for every API route
```

`apps/api/src/rules/` and `research/` don't exist yet — they arrive with the phases that need them (5 and 6). Don't scaffold them early. `auth/` and `market/` arrived in Phase 1: `market/` earlier than originally planned, because instrument charts need price history and prices may never come from a trading API.

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
└── screens/             ← sign-in, not-on-the-list, pots (home), pot detail, holding detail, rules, setup
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

## Data flow (current — stub only)

```
apps/web  →  apps/api/routes  →  providers/stub   (what is held)
                              →  market/stub      (what it's worth, what it's done)
                              →  fixtures/        (the words around the numbers)
```

The frontend never talks to a provider directly and never knows which provider backs a bucket — it only ever calls our own API, always under `/api` (`lib/api.ts`). In dev, Vite proxies `/api` to the Fastify server and strips the prefix, so the API's own paths stay `/rules`, `/portfolio` and so on. The prefix is not cosmetic: several API paths are also screens (`/rules`, `/instruments/:id`), and proxying the bare paths sent a page load or reload of those screens to the API. Test stubs are still keyed by the API's own path; `test/render-route.tsx` strips the prefix. That indirection is the point: Phase 2+ swaps `stub` for `t212`/`kraken` behind the same `Provider` interface with zero frontend changes.

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

**Connecting an account** (`routes/connections.ts`) — `POST /connections/:provider` and `DELETE /connections/:provider`, both behind the guard:

- **Nothing is stored.** Phase 1 builds every screen and state of the connect flow against a handler that inspects the key and forgets it. Phase 2 replaces the body of these handlers with real validation and encrypted per-user storage; the responses the frontend sees don't change.
- **A key that can trade or withdraw is refused outright**, not warned about (CLAUDE.md s13). That rule lives in the API rather than the UI, because a frontend check is cosmetic.
- **Every verdict is a 200.** "That key can do too much" is a considered answer about the key, not a malformed request. The outcome is in the body: `connected`, `invalid_key` or `too_much_access`.
- An unsupported provider is a 404 — Phase 1 supports Trading 212 and Kraken only.

The stub reaches its verdict from the key's shape alone: too short to be real, or carrying a `trade`/`withdraw` scope, or acceptable.

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

- **`client.ts`** — read-only client for the **practice environment only** (`env: "demo"`; anything else throws until Phase 3). HTTP Basic `key:secret`. Every request is a `GET` to an allowlisted path (summary, positions, instrument and exchange metadata, order history); a test reads the source and fails if a write method, `equity/orders` or `pies` ever appears. Methods: `accountSummary`, `positions`, `instruments`, `exchanges`, and `fills()` — an async generator following `nextPagePath` cursor pages, skipping unfilled orders.
- **Errors are typed**: `T212AuthError` (401, never retried), `T212PermissionError` naming the missing permission (T212's 403 is bare, so it's inferred from the endpoint), `T212UnavailableError` (5xx, network, or 429 after retries), `T212ShapeError` (a field Pip relies on is missing — the beta API changed).
- **Rate limits** come from T212's own headers: when `x-ratelimit-remaining` hits 0 the next call to that endpoint waits until `x-ratelimit-reset`; a 429 waits and retries twice, then gives up.
- **`rows.ts`** — responses → stored rows: holdings (quantity and average price at full precision, total cost in pence), cash in pence, instruments, and trades (net value and fees in pence). `currentPrice` and `walletImpact.currentValue` are dropped (hard line 8). Anything not in pounds raises `NotInPoundsError`.
- **`symbols.ts`** — T212 ticker → Yahoo and Alpha Vantage symbols from the exchange the ticker encodes (`GRGl_EQ` → `GRG.L` / `GRG.LON`, `ASMLa_EQ` → `ASML.AS` / `ASML.AMS`, `NVDA_US_EQ` → `NVDA`). Unknown formats give null, for a manual override.
- Tests replay `fixtures/recorded/t212/`; the client was also run once against the practice account (summary, 4 holdings, 4 fills across pages, 17 exchanges).

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

`getFreshness` is per pot, not global, because the staleness ladder names the affected pot ("Side Bet is 2 hours old") and because different pots get different sources from Phase 4 on.

`market/stub` is the only implementation so far. It generates prices from a small deterministic PRNG seeded by the instrument id, so the same holding always draws the same chart and fixtures, tests and screenshots agree. It also takes per-pot staleness overrides — an age in hours, an outright failure, or markets-closed — which is how the green/amber/red ladder gets exercised end to end without a real feed ever having to break. It also takes per-holding **series anchors** (`market/stub/anchors.ts`, built from the stub positions and fixtures in `app.ts` and `server.ts`): the "All" series starts at the average price paid and the "Day" series at this morning's price, the walk blending between its two ends. Without them an invented chart captioned "since you bought" could contradict "+24% since you bought" beside it. `server.ts` reads them from `STUB_STALENESS` (`market/stub/staleness-env.ts`), so the dev server can be put on any rung.

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

**Admin.** `pnpm --filter api allowlist <list|add|remove> [email]` is the only way to grant access.

**In the browser.** Screens never import Supabase. `lib/auth-client.ts` wraps it in a four-method `AuthClient` (get session, listen for changes, send a magic link, sign out). `sendMagicLink` calls `signInWithOtp` with `emailRedirectTo` set to the app's origin, and turns Supabase's send-limit error into `TooManyEmailsError`; `shell/auth-provider.tsx` holds the signed-in state and gives the API client a token getter. The token is read fresh on every request, so one Supabase has just refreshed is always the one sent. `RequireSession` routes by the two walls: no session → `/sign-in`; a session → ask `GET /me`; not allowed → `/not-on-the-list`; allowed → the app. If the API rejects a session the browser still holds (revoked, or expired past refreshing), the browser signs it out rather than redirecting — the sign-in screen would otherwise see a session and send you straight back, forever. Two details keep that from looping: the provider's sign-in and sign-out functions are stable for the life of the client, and a session update that changes nothing hands back the same state object. Tests use `test/fake-auth.ts` instead of Supabase.

**Env vars** (see `.env.example`): `SUPABASE_URL` for the API — the server won't start without it. The web app needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; without them it shows "Pip isn't configured" rather than a blank page. The publishable key is public by design — which is exactly why every table has RLS on.

## Storage

Postgres via Drizzle ORM, on Supabase. Single `DATABASE_URL` env var, nothing else host-specific (CLAUDE.md s3; never Render's free Postgres, it expires after 30 days).

- **The database is hosted in every environment** — on Supabase, with a separate project for development (`pip`, eu-west-1). No local Postgres, no Docker. The server connects through the **session pooler** (port 5432), which suits a long-running process. Nothing in the test suite or CI ever talks to it.
- `apps/api/drizzle/` — migration SQL, committed. `pnpm --filter api db:generate` writes one from the schema; hand-written SQL (RLS, policies, grants, functions) uses `drizzle-kit generate --custom`. `db:migrate` applies them; they're applied to the dev project.
- `apps/api/src/db/client.ts` — `getDb()` is a lazy singleton on the privileged connection. No socket opens until a caller queries; nothing in tests or CI calls it.

**Tables** (`src/db/schema.ts`). Money in pence of pounds is `bigint`; provider prices and quantities keep full precision as `numeric` and become pence only at the edge.

| Table                  | What                                                                                                                                                                            | Who can read it (as `authenticated`)                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `users`                | **The allowlist** — email, name, `auth_user_id` (links to Supabase `auth.users` on first sign-in; a plain uuid, so migrations never touch Supabase's `auth` schema)             | nobody — server only                                                  |
| `waitlist`             | Refused sign-ins, address from the verified token only                                                                                                                          | nobody — server only                                                  |
| `provider_credentials` | One row per user + provider + account kind (`isa`/`invest`): sealed key and secret, key version, status, account currency, last verified/polled, backfill status, history start | own rows, **status columns only** — the sealed columns aren't granted |
| `holdings`             | Latest poll per credential: instrument, quantity, average price paid, total cost in pence                                                                                       | own rows                                                              |
| `cash`                 | Latest poll per credential, in pence                                                                                                                                            | own rows                                                              |
| `trades`               | Filled orders from provider history, keyed by fill id so re-reading never double-counts                                                                                         | own rows                                                              |
| `daily_values`         | Each pot's value and cost at each day's close (`backfill` or `snapshot`)                                                                                                        | own rows                                                              |
| `instruments`          | Keyed by **T212 ticker** (ISINs aren't unique across listings); ISIN, name, currency incl. GBX, working schedule, Yahoo / Alpha Vantage symbols (+ override flag)               | any signed-in user                                                    |
| `prices`               | Latest price per instrument or `FX:<pair>`, previous close, source, as-of, last failure                                                                                         | any signed-in user                                                    |
| `daily_closes`         | Daily closes per instrument or FX pair                                                                                                                                          | any signed-in user                                                    |
| `intraday_series`      | Today's points per instrument, for the Day chart                                                                                                                                | any signed-in user                                                    |
| `source_usage`         | Calls per market-data source per day, for call budgets                                                                                                                          | nobody — server only                                                  |

**Row Level Security is on for every table** (`0001`, `0003`). The web app ships Supabase's public key and Supabase's REST API exposes `public` tables to it, so a table without RLS would be readable by anyone.

- **Signed-in users only ever read.** All grants to `anon` and `authenticated` are revoked, then `SELECT` is granted back where the table above says so. Every write goes through the server's privileged connection.
- **"Own rows"** means `user_id = private.current_app_user_id()`: a `SECURITY DEFINER` function mapping `auth.uid()` to the caller's allowlist row. It lives in a `private` schema (`0004`) because Supabase exposes `public` functions over REST.
- **Checked twice.** `db/rls.test.ts` reads the migrations and fails if a table lacks RLS, a user-owned table (any table with `user_id`) lacks an own-rows policy using the private helper, or the sealed credential columns are ever granted. And the policies were probed on the dev database as two throwaway users in a rolled-back transaction: each saw only their own rows; sealed columns, writes and `source_usage` were refused; shared instruments were visible. Supabase's security advisor reports nothing beyond the intended "RLS enabled, no policy" on the server-only tables.

**Reading as the user** (`db/user-scope.ts`). User-facing reads run inside `asUser(db, authUserId, work)`: one transaction that sets the verified Supabase user id as `request.jwt.claims` and `SET LOCAL ROLE authenticated`, so the policies above decide what `work` can see. Both settings are transaction-local, so nothing leaks into the next request on a pooled connection. `authUserId` always comes from the verified token (`request.authUser`), and `asUser` refuses anything that isn't a uuid. The guard links an allowlist row to its Supabase identity on first contact (not only on `/me`), because the policies find a user's rows through that link — an unlinked user sees nothing. Scheduled jobs and credential writes use the privileged connection directly.

**Testing RLS without a network.** `test-support/pglite.ts` starts an in-process Postgres (PGlite), recreates the bits of Supabase the migrations rely on (`anon`, `authenticated`, `auth.uid()`), and applies every real migration in journal order. `db/user-scope.test.ts` seeds two users and proves — below the route layer, with queries that have no `where` clause — that each sees only their own rows, can't read sealed columns, can't write, can read shared market data, and that the role doesn't survive the transaction. `asUser` was also checked against the Supabase dev project through the session pooler.

Auth and route tests otherwise use in-memory stores, and CI never talks to Supabase.

## Env flags

| Var                                                  | Purpose                                                                                                                                         | Default                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `PROVIDER_MODE`                                      | `stub` (fake data) or `t212` (Trading 212, Phase 2+). `t212` needs `MASTER_KEY`, and until Phase 2 wires the read routes the server refuses it  | `stub`                                      |
| `MASTER_KEY`                                         | 32 random bytes, base64 — seals provider keys. **Render only**; never in Supabase, git or chat. `pnpm --filter api master-key` makes one        | none — required for `t212`                  |
| `MASTER_KEY_VERSION`                                 | Which version `MASTER_KEY` is; stamped on every sealed value                                                                                    | `1`                                         |
| `MASTER_KEY_PREVIOUS`, `MASTER_KEY_PREVIOUS_VERSION` | Only during a rotation: the old key, so old values can be opened and re-sealed                                                                  | none                                        |
| `LOG_LEVEL`                                          | pino level for the server                                                                                                                       | `info`                                      |
| `DATABASE_URL`                                       | Postgres connection string                                                                                                                      | none — required once a route touches the DB |
| `PORT`                                               | apps/api listen port                                                                                                                            | `3001`                                      |
| `STUB_STALENESS`                                     | Stub only: force the staleness ladder, e.g. `Degen:2` (amber), `Degen:failed` (red), `all:closed`. Unreadable values stop the server at startup | empty — everything fresh                    |

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

`StubProvider` is instantiated per bucket and returns constant fake positions/cash/history. It has no network calls, no filesystem access, no DB access — safe for unit tests and CI. `PROVIDER_MODE=stub` is the default everywhere except explicit live phases (2+).

## Testing

Vitest in all three packages (`apps/web`, `apps/api`, `packages/shared`). `apps/web` additionally uses Testing Library + jsdom for component tests. `apps/api/vitest.config.ts` excludes `dist/`: `pnpm build` emits compiled output there, and vitest's default include would otherwise collect it, running every suite twice — the second time against whatever was last compiled. `pnpm test` from the root runs all three via `pnpm -r test`. `apps/api/src/fixtures/consistency.test.ts` checks the sample data agrees with itself — percentages against pounds, since-you-bought against the price paid, value against market price, chart ends against their anchors — because stub numbers are still numbers someone reads. CI (`.github/workflows/ci.yml`) runs lint, format check, test, and build on every push to `main` and every PR, entirely in stub mode with no secrets configured.
