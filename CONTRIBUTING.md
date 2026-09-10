# Contributing to FlowForge

Thanks for your interest in contributing! This guide will help you get set up
and understand the conventions used across the repo.

## Development setup

Prerequisites: **Node.js ≥ 20** (`.nvmrc` pins the recommended version) and
**pnpm 10.23.0+**. The repo is pinned with `corepack`/`packageManager`.

```bash
pnpm install --frozen-lockfile   # deterministic install (lockfile is committed)

# Docker for the backing stores
docker compose up -d postgres redis

# Build workspaces in dependency order: shared → engine → api/worker → web
pnpm build

# One-time DB schema + demo seed
pnpm migrate
pnpm seed

# Run all apps locally (API :3000, worker, SPA :5173)
pnpm dev
```

Never commit generated artifacts, `node_modules`, `.env`, or local data.

## Repository layout

- `packages/shared` — validation schemas, types, constants.
- `packages/engine` — transactional state machine (created with the API, used by the worker).
- `apps/api` — NestJS + Fastify REST API.
- `apps/worker` — outbox relay, run consumer, step pool, reconciler.
- `apps/web` — React 18 + Vite SPA.
- `.github/workflows/ci.yml` — the CI pipeline.

## Before you code

- **Check for an open issue** and comment that you're working on it.
- For behavior changes, add a test (unit or e2e) that proves the new behavior.
- Keep changes scoped; a PR that does one thing is much easier to review.

## Commands

| Command | What it does |
|---------|--------------|
| `pnpm build` | Builds all workspaces (shared → engine → api → worker → web) |
| `pnpm lint` | ESLint across all workspaces |
| `pnpm typecheck` | `tsc --noEmit` across all workspaces |
| `pnpm test` | Unit tests: shared (vitest), engine (vitest), api (jest) |
| `pnpm test:e2e` | End-to-end tests against a real Postgres + Redis (worker required) |
| `pnpm migrate` | Run DB migrations against `DATABASE_URL` |
| `pnpm seed` | Populate the demo organization, project, keys, and workflows |
| `pnpm format` | Prettier-write the whole codebase |

The e2e suite assumes the infrastructure is running and that the worker is
started (e.g. `docker compose up -d` plus a running worker). CI starts
Postgres/Redis as service containers, runs migrations, and launches the worker
before the suite.

## Code style

- TypeScript strict, ESLint + Prettier enforced by CI — run
  `pnpm lint`/`pnpm typecheck` before pushing.
- Follow existing patterns: Zod for request validation, transactional outbox
  for anything that mutates run/step state, idempotency keys for external
  triggers.
- No `any` escapes; database rows are typed at the service boundary.
- No structural secrets in code or committed files. Use `.env` (gitignored).

## Pull request workflow

1. Branch from `main` with a descriptive name (e.g. `fix/runs-retry-rbac`).
2. Implement + tests, then run `pnpm lint && pnpm typecheck && pnpm test`.
3. Where relevant, run `pnpm test:e2e` and confirm the full suite is green.
4. Open a PR with a summary of the change, tests run, and any caveats.
5. Keep the diff focused; the maintainers will review it and iterate with you.

## Commit message convention

Prefix the subject with a conventional-commit type so the changelog can be
generated later: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`,
`perf:`, `security:`.

## Code of conduct

Participation in this project is governed by our
[Code of Conduct](CODE_OF_CONDUCT.md). Be kind, be constructive, and assume
good faith.