# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Phase 1 — Base UI + auth

- Added: `docs/phases/phase-1.md` — Phase 1 plan from the Claude Design handover (Pip), with scope decisions, hard-line design corrections and a 20-task breakdown (#3226664834)
- Added: design assets — `docs/design/Pip.dc.html` reference, logo mark SVGs in `apps/web/src/assets/brand/`, favicon and PWA/apple-touch icons, self-hosted Caprasimo + Figtree via `@fontsource`, `lucide-react` (#3226676914)
- Changed: `index.html` and the PWA manifest now carry the Pip name, description and cream/dark theme colours (#3226676914)
- Removed: unreferenced `apps/web/public/icons.svg` left over from the Phase 0 scaffold (#3226676914)
- Added: `docs/DESIGN.md` — product voice, pot identities, brand tokens (light/dark/per-pot), type scale, copy rules, the seven data blocks, screen inventory with every state, and the hard-line corrections to the prototype (#3226691677)
- Changed: `.prettierignore` now covers `docs/design/`, so the design handover is never reformatted
- Changed: second design handover — `docs/design/Pip.dc.html` updated with desktop/tablet layouts, the mark at icon sizes and the amber staleness state (#3226676914)
- Added: small-cut logo `pip-mark-small.svg` (16–48px geometry); favicon rebuilt on it; maskable icon rebuilt as the terracotta plate with the reversed mark (#3226676914)
- Changed: `docs/DESIGN.md` rewritten — amber state tokens and the staleness ladder, three breakpoints with the sidebar/rail navigation, the desktop four-column table, and both icon cuts (#3226691677)
- Changed: `docs/phases/phase-1.md` replanned for the second handover — responsive work folded in, task list now 22 items (#3226664834)
- Added: `BUCKET_META` in `packages/shared` — display name, accent scope and provider per bucket id, so UI names never reach the API or database (#3226691676)
- Added: `packages/shared/src/api.ts` — response types for portfolio, bucket detail, instrument detail, rules, activity, connections and the connect flow, with money as integer pence and per-pot `PriceFreshness` (#3226691676)
- Added: `docker-compose.yml` — local Postgres 17 for development, serving the `DATABASE_URL` in `.env.example` (#3226691746)
- Added: Auth.js tables (`accounts`, `sessions`, `verification_tokens`) and `waitlist` to the Drizzle schema; `users` gains the profile columns Auth.js expects (#3226691746)
- Added: first generated migration in `apps/api/drizzle/`, plus `db:generate` / `db:migrate` / `db:studio` scripts (#3226691746)

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
