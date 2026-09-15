# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Phase 0 — Scaffold

- Added: pnpm workspace root — `pnpm-workspace.yaml`, root `package.json`, shared `tsconfig.base.json`, ESLint 9 flat config, Prettier, `.gitignore`, `.env.example` (#3226662417)
- Added: `apps/web` — Vite + React 19 + TypeScript + Tailwind v4 + PWA plugin, mobile-first placeholder screen rendering the three buckets from `@finance-app/shared`, Vitest + Testing Library (#3226662419)
- Added: `apps/api` — Fastify server with a `/health` route, `src/providers/provider.ts` trading-provider interface, Vitest (#3226660714)
- Added: `packages/shared` — `BUCKETS`/`Bucket` constant, consumed by both apps via `workspace:*` (#3226662418)
- Added: stub trading provider (`apps/api/src/providers/stub`) implementing `getPositions`/`getCash`/`getHistory` with fake per-bucket data, selected via `PROVIDER_MODE=stub` (#3226662452)
- Added: Postgres + Drizzle wiring in `apps/api` — `drizzle.config.ts`, lazy `DATABASE_URL` client, minimal multi-user schema (`users`, `allowlist`); no live DB touched by tests (#3226662656)
- Added: CI pipeline (`.github/workflows/ci.yml`) — install, lint, format check, test, build on every push to `main` and every PR, stub mode only, no secrets configured (#3226662384)
- Added: `docs/ARCHITECTURE.md` and `docs/FEATURES.md`, plus a `docs/DESIGN.md` placeholder blocked on the Phase 1 Claude Design handover (#3226662383)
- Added: this changelog, in keep-a-changelog format (#3226660804)
- Changed: Phase 0's DB task rescoped from SQLite to Postgres + multi-user schema to match the updated CLAUDE.md; see `docs/phases/phase-0.md`
