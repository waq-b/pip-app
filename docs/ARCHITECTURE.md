# Architecture

Living doc. Reflects what's actually built, not what's planned — check `docs/phases/phase-N.md` for what's coming. Last updated: Phase 1, through the stub API.

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
│           ├── auth/       ← Auth.js config, Fastify mount, guard, waitlist
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
│   ├── theme.ts         ← appearance: follow the device, or a stored choice
│   └── use-appearance.ts
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

## Data flow (current — stub only)

```
apps/web  →  apps/api/routes  →  providers/stub   (what is held)
                              →  market/stub      (what it's worth, what it's done)
                              →  fixtures/        (the words around the numbers)
```

The frontend never talks to a provider directly and never knows which provider backs a bucket — it only ever calls our own API. That indirection is the point: Phase 2+ swaps `stub` for `t212`/`kraken` behind the same `Provider` interface with zero frontend changes.

**The read routes** (`routes/read.ts`), all behind the session guard:

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

Google is the only way in, and being known to Google is not the same as being allowed in — the `allowlist` table decides that (CLAUDE.md hard line 4).

**Mounting.** There is no official Fastify adapter (`@auth/fastify` is not published), so `apps/api/src/auth/plugin.ts` mounts `@auth/core`'s `Auth()` handler on `/auth/*` itself: it converts the Fastify request into a Web `Request`, and pipes the `Response` back. Two details matter — Auth.js parses the form body itself, so the plugin registers a raw `application/x-www-form-urlencoded` parser inside its own scope; and `Set-Cookie` can repeat, so the response path uses `Headers.getSetCookie()` rather than the collapsing accessor.

**The gate.** `callbacks.signIn` (in `auth/config.ts`) is the wall. It refuses anyone whose email Google hasn't verified, anyone absent from the allowlist, and anyone with no email at all, redirecting each to `/not-on-the-list`. An empty allowlist therefore admits nobody, which is the correct default.

**Sessions** are server-side rows, never JWTs: the cookie carries a token and nothing else. Two clocks run:

- `expires` — Auth.js rolls it forward while you're active, so a session dies 12 hours after you stop using it.
- `sessions.created_at` — ours, because Auth.js only has a rolling window. `isLive()` in `auth/session.ts` caps the session at 7 days however active you've been. The route guard enforces it.

**Testability.** `AllowlistStore` and `SessionStore` are interfaces with a Postgres implementation and an in-memory one. Tests inject the in-memory versions, and `buildApp()` takes the auth config as an option, so the app starts with no environment and no database — the suite never opens a socket.

**Admin.** `pnpm --filter api allowlist <list|add|remove> [email]` is the only way to grant access. Removing an address stops the next sign-in; existing sessions live out their span.

**Route protection.** `registerSessionGuard` (in `auth/guard.ts`) adds an `onRequest` hook to the root instance — deliberately not via `register`, which would encapsulate it into a child scope and quietly leave sibling routes open. It runs before every route, including ones added later, so **a route is protected by existing**. Only `/health`, `/auth/*` and `/waitlist` are exempt. A request with no cookie is refused without touching the store, so refusing an unauthenticated caller never needs a database.

**The waitlist exemption.** `/waitlist` has no session by definition — the person asking has just been refused one. It is not open, though: the rejected sign-in mints a token (`auth/waitlist-token.ts`) carrying the address Google has just verified, signed with `AUTH_SECRET` and valid for 15 minutes, and the route takes the email from **inside** the token rather than from the request body. So nobody can add an address to the waiting list without first proving to Google that it's theirs, and a body that says otherwise is ignored. Signature comparison is constant-time, and a length mismatch returns false rather than throwing. If no secret is configured the route isn't registered at all — a route that can't verify its own token shouldn't exist.

Being on the waiting list grants nothing. Access still comes from the allowlist, by hand.

`guard.test.ts` enforces that rather than trusting it: it walks the app's real route table via the `onRoute` hook and asserts every non-exempt route answers 401 without a session. Adding an unprotected route fails the suite without anyone having to add a case, and the test fails rather than passing vacuously if the table is ever empty.

**Env vars** (see `.env.example`): `AUTH_SECRET`, `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`. All four are required for the server to boot — `authConfigFromEnv` throws rather than starting half-configured. Cookies are only marked `Secure` when `AUTH_URL` is https.

## Storage

Postgres via Drizzle ORM. Single `DATABASE_URL` env var — works against local Docker Postgres, Neon, or Supabase, nothing host-specific (see CLAUDE.md section 3; never Render's free Postgres, it expires after 30 days).

- **The database is hosted in every environment** — Neon or Supabase, with a separate database for development. There is no local Postgres and no Docker: one `DATABASE_URL` is the whole story, which is also what keeps the app portable (CLAUDE.md s3). Nothing in the test suite or CI ever talks to it.
- `apps/api/drizzle.config.ts` — drizzle-kit config, points at `DATABASE_URL`
- `apps/api/drizzle/` — generated migration SQL, committed. `pnpm --filter api db:generate` writes a new one from the schema; `db:migrate` applies it.
- `apps/api/src/db/schema.ts` — current tables:
  - `users` (id, email, name, image, email_verified, created_at)
  - `allowlist` (email, created_at) — the wall. Google proves identity; this table grants access.
  - `waitlist` (email, name, requested_at) — a rejected sign-in, holding a Google-verified address only
  - `accounts`, `sessions`, `verification_tokens` — Auth.js tables. Column names are dictated by `@auth/drizzle-adapter`, which queries them by name, so they don't follow house style.
- `apps/api/src/db/client.ts` — `getDb()` is a lazy singleton. No socket opens until a caller actually queries. Nothing in the test suite or CI imports/calls it, so tests never touch a real database (hard line: no real network calls in tests).

The migrations are generated and committed but have not been applied anywhere yet — that waits on a hosted `DATABASE_URL`. Until then the schema is verified by type-checking and by drizzle-kit's own generation step. To apply them: put the connection string in `apps/api/.env` (gitignored) and run `pnpm --filter api db:migrate`.

Auth is the first thing that needs a live database to exercise by hand; its tests use an injected in-memory session store instead, so CI stays databaseless whatever happens to the hosting.

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
