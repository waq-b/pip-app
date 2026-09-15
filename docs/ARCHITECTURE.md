# Architecture

Living doc. Reflects what's actually built, not what's planned — check `docs/phases/phase-N.md` for what's coming. Last updated: Phase 0.

## Monorepo layout

```
finance-app-personal/
├── CLAUDE.md
├── CHANGELOG.md
├── docs/
│   ├── ARCHITECTURE.md    ← this file
│   ├── FEATURES.md
│   ├── DESIGN.md          ← placeholder, blocked on Phase 1 design gate
│   └── phases/
│       └── phase-0.md
├── apps/
│   ├── web/                ← React frontend (Vite + TS + Tailwind v4 + PWA)
│   └── api/                ← Fastify backend
│       └── src/
│           ├── app.ts       ← Fastify instance + routes (currently just /health)
│           ├── server.ts    ← process entrypoint, listens on PORT
│           ├── db/
│           │   ├── client.ts   ← lazy Drizzle/Postgres client (getDb())
│           │   └── schema.ts   ← users, allowlist tables
│           └── providers/
│               ├── provider.ts ← common trading-provider interface
│               └── stub/       ← fake data, used in tests and Phase 0/1
└── packages/
    └── shared/              ← types shared between web and api
        └── src/buckets.ts    ← BUCKETS constant, Bucket type
```

`apps/api/src/auth/`, `market/`, `rules/`, `research/` don't exist yet — they arrive with the phases that need them (1, 2, 5, 6 respectively). Don't scaffold them early.

## Bucket model

Three buckets, defined once in `packages/shared/src/buckets.ts`:

```ts
export const BUCKETS = ["Base", "Medium", "Degen"] as const;
export type Bucket = (typeof BUCKETS)[number];
```

Both apps import this — nothing hardcodes bucket names elsewhere. Each bucket maps to exactly one trading provider (Base/Medium → Trading 212, Degen → Kraken); see CLAUDE.md section 1 for what each bucket is for.

## Data flow (current — stub only)

```
apps/web  →  apps/api (/health today; bucket routes arrive in Phase 1)  →  providers/stub
```

The frontend never talks to a provider directly and never knows which provider backs a bucket — it only ever calls our own API. That indirection is the point: Phase 2+ swaps `stub` for `t212`/`kraken` behind the same `Provider` interface with zero frontend changes.

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

A separate `market/` provider layer (prices, historical series — CLAUDE.md section 4) does not exist yet; it's introduced in Phase 2 alongside the first market data source.

## Storage

Postgres via Drizzle ORM. Single `DATABASE_URL` env var — works against local Docker Postgres, Neon, or Supabase, nothing host-specific (see CLAUDE.md section 3; never Render's free Postgres, it expires after 30 days).

- `apps/api/drizzle.config.ts` — drizzle-kit config, points at `DATABASE_URL`
- `apps/api/src/db/schema.ts` — current tables:
  - `users` (id, email, created_at)
  - `allowlist` (email, created_at)
- `apps/api/src/db/client.ts` — `getDb()` is a lazy singleton. No socket opens until a caller actually queries. Nothing in the test suite or CI imports/calls it, so tests never touch a real database (hard line: no real network calls in tests).

No migrations have been run against a real database yet — there is no Postgres instance in this environment. Schema is verified by type-checking only. Phase 1+ is the first time a real `DATABASE_URL` will need to exist (for auth).

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

Vitest in all three packages (`apps/web`, `apps/api`, `packages/shared`). `apps/web` additionally uses Testing Library + jsdom for component tests. `pnpm test` from the root runs all three via `pnpm -r test`. CI (`.github/workflows/ci.yml`) runs lint, format check, test, and build on every push to `main` and every PR, entirely in stub mode with no secrets configured.
