# Architecture

Living doc. Reflects what's actually built, not what's planned — check `docs/phases/phase-N.md` for what's coming. Last updated: Phase 1, through the stub API.

## Platform: Supabase (decided 2026-09-16)

Supabase for Postgres and Auth, with Fastify kept as the backend and the wall (CLAUDE.md s3).

**Built:** the API side of Supabase Auth — see [Auth](#auth) — and Row Level Security switched on for every table. **Not built yet:**

- **Web sign-in** through the Supabase client (Phase 1 rework task R3).
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
│       └── phase-1.md
├── apps/
│   ├── web/                ← React frontend (Vite + TS + Tailwind v4 + PWA)
│   └── api/                ← Fastify backend
│       └── src/
│           ├── app.ts       ← Fastify instance: guard, then routes
│           ├── server.ts    ← process entrypoint, listens on PORT
│           ├── auth/       ← Supabase JWT verification, allowlist, guard, /me, waitlist
│           ├── db/
│           │   ├── client.ts   ← lazy Drizzle/Postgres client (getDb())
│           │   └── schema.ts   ← users, allowlist, waitlist, Auth.js tables
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
- **`PriceFreshness`** carries the market-data source, the last successful read, whether the last fetch failed, and whether markets are closed. It names a market-data source, never a trading API (hard line 8). Deriving the green/amber/red state from it belongs to the staleness ladder task, not to these types.

## Web app

`apps/web` is a Vite + React 19 PWA. Structure so far:

```
apps/web/src/
├── index.css            ← every DESIGN.md token, as CSS variables + Tailwind v4 theme
├── App.tsx              ← query client, router, appearance
├── routes.tsx           ← the route table
├── lib/
│   ├── api.ts           ← the only way to reach the API; same-origin, 401 is its own error
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
│   └── pip-mark.tsx     ← the mark, choosing its own cut by size
└── screens/             ← one per screen, arriving in tasks 15–20
```

**Tokens.** `index.css` declares every colour as a `--pip-*` variable for light, overrides them for dark, and maps them into Tailwind with `@theme inline` — so `bg-card` resolves to the live variable and dark mode is a variable swap, never a second set of classes. Pot scopes (`.pot-fnd`, `.pot-pick`, `.pot-bet`) override only the accent trio, so anything inside one paints itself in that pot's colour without knowing which pot it is. No component carries a hex value — and `shell/pip-mark.test.tsx` enforces that rather than trusting it, because two slipped through before the test existed and both broke dark mode. The mark's seeds and the alert dot have their own tokens (`--pip-seed-fnd/pick/bet`, `--pip-alert`), separate from the accent, because they must not change when a pot scope does.

**Appearance.** Follows the device until someone chooses in Setup. The `data-theme` attribute is written only for an explicit choice; leaving it off for "system" keeps the media query in charge, so the app follows the device live rather than at load. Storage access is wrapped, because private browsing throws rather than returning null.

**The shell.** Signed-in screens render inside `AppShell`; sign-in and the not-on-the-list screen deliberately don't, because neither has a sidebar or a hero number. Three layouts, one set of destinations:

| Width     | Navigation                                       | Content cap |
| --------- | ------------------------------------------------ | ----------- |
| under 768 | tab bar along the bottom                         | —           |
| 768+      | 76px icon rail                                   | 640         |
| 1120+     | 232px labelled sidebar, with the read-only badge | 1080        |

**Active state comes from `nav.ts`, not from the router.** Each destination has its own `matches(pathname)`, and every layout uses it. This isn't a style choice: React Router's `NavLink` computes `aria-current` from its own path matching and overwrites the prop you pass, so with `end` on the Pots link it went dark the moment you opened a pot. Pot detail and instrument detail live under Pots, so Pots has to stay lit there.

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

The frontend never talks to a provider directly and never knows which provider backs a bucket — it only ever calls our own API. That indirection is the point: Phase 2+ swaps `stub` for `t212`/`kraken` behind the same `Provider` interface with zero frontend changes.

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

`StubProvider` (`apps/api/src/providers/stub/index.ts`) is the only implementation so far. It returns fixed fake data per bucket, so unit tests never make a network call. `t212/` and `kraken/` implementations arrive in Phase 2 and 4.

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

`market/stub` is the only implementation so far. It generates prices from a small deterministic PRNG seeded by the instrument id, so the same holding always draws the same chart and fixtures, tests and screenshots agree. It also takes per-pot staleness overrides — an age in hours, an outright failure, or markets-closed — which is how the green/amber/red ladder gets exercised end to end without a real feed ever having to break.

## Auth

Supabase Auth, Google only, proves who someone is. A row in our own `users` table is what lets them in (CLAUDE.md s3, hard line 4). Sign-in itself happens between the browser and Supabase; the API never sees a password or an OAuth callback.

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

**Env vars** (see `.env.example`): `SUPABASE_URL` for the API — the server won't start without it. The web app's `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` arrive with web sign-in.

## Storage

Postgres via Drizzle ORM, on Supabase. Single `DATABASE_URL` env var, nothing else host-specific (CLAUDE.md s3; never Render's free Postgres, it expires after 30 days).

- **The database is hosted in every environment** — on Supabase, with a separate project for development. There is no local Postgres and no Docker: one `DATABASE_URL` is the whole story, which is also what keeps the app portable (CLAUDE.md s3). Nothing in the test suite or CI ever talks to it.
- `apps/api/drizzle.config.ts` — drizzle-kit config, points at `DATABASE_URL`
- `apps/api/drizzle/` — generated migration SQL, committed. `pnpm --filter api db:generate` writes a new one from the schema; `db:migrate` applies it.
- `apps/api/src/db/schema.ts` — current tables:
  - `users` (id, email, name, auth_user_id, created_at) — **the allowlist**. Rows are added by hand, keyed by email, before anyone signs in. `auth_user_id` links a row to Supabase's `auth.users` on first arrival; it's a plain uuid rather than a foreign key, so our migrations never reach into the `auth` schema Supabase owns.
  - `waitlist` (email, name, requested_at) — someone refused, holding the address from their verified token only.
- **Row Level Security is on for every table**, with no policies (`drizzle/0001_enable_row_level_security.sql`). The web app ships Supabase's public key, and Supabase's REST API exposes every `public` table to it, so a table without RLS would be readable by anyone. `db/rls.test.ts` reads the migrations and fails if any table in the schema lacks the line, so a new table can't forget.
- `apps/api/src/db/client.ts` — `getDb()` is a lazy singleton. No socket opens until a caller actually queries. Nothing in the test suite or CI imports/calls it, so tests never touch a real database (hard line: no real network calls in tests).

The migrations are generated and committed but have not been applied anywhere yet — that waits on a hosted `DATABASE_URL`. Until then the schema is verified by type-checking and by drizzle-kit's own generation step. To apply them: put the connection string in `apps/api/.env` (gitignored) and run `pnpm --filter api db:migrate`.

Auth is the first thing that needs a live database to exercise by hand; its tests use in-memory stores instead, so CI stays databaseless whatever happens to the hosting.

## Env flags

| Var             | Purpose                                                      | Default                                     |
| --------------- | ------------------------------------------------------------ | ------------------------------------------- |
| `PROVIDER_MODE` | `stub` (fake data) or `live` (real providers, from Phase 2+) | `stub`                                      |
| `DATABASE_URL`  | Postgres connection string                                   | none — required once a route touches the DB |
| `PORT`          | apps/api listen port                                         | `3001`                                      |

Provider secrets (`T212_API_KEY`, `KRAKEN_API_KEY`, etc.) don't exist as env vars yet — Phase 2+ moves to per-user encrypted keys stored in Postgres, not global env vars (CLAUDE.md section 3, "Key storage").

## How stub mode works

`StubProvider` is instantiated per bucket and returns constant fake positions/cash/history. It has no network calls, no filesystem access, no DB access — safe for unit tests and CI. `PROVIDER_MODE=stub` is the default everywhere except explicit live phases (2+).

## Testing

Vitest in all three packages (`apps/web`, `apps/api`, `packages/shared`). `apps/web` additionally uses Testing Library + jsdom for component tests. `apps/api/vitest.config.ts` excludes `dist/`: `pnpm build` emits compiled output there, and vitest's default include would otherwise collect it, running every suite twice — the second time against whatever was last compiled. `pnpm test` from the root runs all three via `pnpm -r test`. CI (`.github/workflows/ci.yml`) runs lint, format check, test, and build on every push to `main` and every PR, entirely in stub mode with no secrets configured.
