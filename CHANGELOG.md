# Changelog

All notable changes to this project are documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Save Draft workflow**: `POST /api/workflows/draft` endpoint (OWNER/DEVELOPER)
  with org scoping and project-membership validation, plus a **Save Draft** action
  in the workflow editor. Publishing a workflow now keeps editing the same
  definition at version 0 while the published version stays immutable at
  version 1+.
- **Signup rate limiting**: per-IP fixed-window limit on `POST /api/auth/signup`
  (default 5 attempts/minute, configurable via `RATE_LIMIT_MAX_SIGNUP` and
  `RATE_LIMIT_WINDOW_SECONDS`).
- **Security headers** via `@fastify/helmet` (`X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, HSTS when served over HTTPS).
- `VITE_DEMO_CREDENTIALS` build flag gates demo-credential pre-fill on the login
  page (empty by default; set to `true` for demo deployments).
- Project documentation: `LICENSE` (MIT), `SECURITY.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `.nvmrc`.
- Open-source release prep: professional README (usage, architecture, roadmap,
  limitations), GitHub issue/PR templates, and `license`/`description` metadata
  on every workspace package.
- SECURITY.md and CHANGELOG now state the actual password-hashing scheme
  (salted SHA-256), not argon2id.

### Changed

- `retry` and `cancel` on runs now require `OWNER` or `DEVELOPER` role
  (previously any authenticated member).
- Pin `fastify` to a single version (`4.28.1`) across the monorepo to avoid a
  duplicate-instance type mismatch surfaced by the helmet plugin.
- Reproducibility: CI installs with `pnpm install --frozen-lockfile`, uses the
  pinned `pnpm@10.23.0`, and the e2e job now runs migrations and starts the
  worker against clean service containers.
- README and `.env.example` refreshed with the full environment-variable
  surface and a production deployment note.

### Fixed

- `saveDraft` no longer returns a 500 when a previously `SUPERSEDED` draft
  (version 0) is reused — the leftover draft is absorbed back to `DRAFT` status.
- `GET /api/workflows/:id` (with versions) no longer fails due to an ambiguous
  `id` column when joining users.
- **Bodyless POST with `Content-Type: application/json` no longer crashes with a
  500** (Fastify "Body cannot be empty"). Empty bodies parse to `{}`, so the SPA
  retry/cancel buttons — which send no body — now reach the business logic. The
  web client also only sets `Content-Type` when a body is present.
- Dockerfile comment and install flag now reflect that the lockfile **is**
  committed (`--frozen-lockfile`).

## [1.0.0] - 2026-09-01

### Added

Initial release. Multi-tenant workflow orchestration platform featuring:

- Organizations, projects, and role-based access (OWNER / DEVELOPER / VIEWER).
- JWT auth with salted SHA-256 password hashing and refresh-token sessions.
- Workflow editor (SPA) with draft + publish lifecycle.
- Runs with transactional outbox, idempotency keys, worker leases, heartbeats,
  and a reconciler for lease recovery.
- Step types: `HTTP_REQUEST`, `DELAY`, `TRANSFORM` (template-only, no code
  execution).
- Scheduling, webhook triggers, API keys, audit log, Prometheus metrics, and a
  Swagger/OpenAPI document.