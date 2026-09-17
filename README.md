# FlowForge

**Multi-tenant workflow orchestration with durable, idempotent runs** — build
workflows with HTTP calls, delays, and template transforms; run them via API,
webhook, or cron schedule; and watch every step execute reliably across
worker processes.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%E2%89%A520-green)
![pnpm](https://img.shields.io/badge/pnpm-10.23.0-orange)
[![CI](https://github.com/PrinceInTech/flowforge/actions/workflows/ci.yml/badge.svg)](https://github.com/PrinceInTech/flowforge/actions/workflows/ci.yml)

---

## Problem statement

Orchestrating asynchronous jobs — chaining HTTP calls, adding delays, retrying
failures, and resuming after crashes — is usually solved by wiring together
queues, cron daemons, and bespoke retry logic in every service. That melts down
on multi-tenant products: one team's retry storm starves another team's jobs,
runs get lost between producer and consumer, and there is no single place to
see "what happened" when a workflow fails.

FlowForge isolates that complexity behind one self-hostable platform: define a
workflow as **typed steps**, trigger it from **API keys, webhooks, or cron
schedules**, and let a durable **transactional outbox** drive the run — so no
step is ever lost and every transition is inspectable.

## Key features

- **Multi-tenant by design** — Organizations → Projects with role-based access
  (`OWNER`, `DEVELOPER`, `VIEWER`), scoped API keys, and a per-org audit log.
- **Workflow steps** — `HTTP_REQUEST` (GET/POST/PUT/PATCH/DELETE with
  per-request timeout), `DELAY`, and `TRANSFORM` (template interpolation, no
  code execution). Steps declare `dependsOn` for DAG ordering.
- **Durable run execution** — the transactional outbox pattern guarantees a
  run (and its step transitions) are written to PostgreSQL and the wake-up
  event published to Redis in the same transaction; an outbox relay polls and
  republishes, so messages are never lost.
- **Idempotency everywhere** — idempotency-keyed API triggers return the same
  run for duplicate calls; consumers ignore stale messages; `FOR UPDATE SKIP
  LOCKED` row locks prevent double-processing.
- **Retries with exponential backoff + full jitter** — per-step
  `retryPolicy: { maxRetries, backoffMs, maxBackoffMs }`, plus manual retry and
  cancel of failed runs.
- **Lease-based long steps** — long-running steps hold a `worker_leases` row
  with a TTL and heartbeat; a reconciler safely recovers expired leases after
  a worker dies.
- **Triggers** — authenticated API-key trigger with per-key rate limits, an
  unauthenticated webhook endpoint, and cron-based schedules.
- **Observability** — Swagger/OpenAPI at `/api/docs`, Prometheus metrics at
  `/api/metrics`, and a health endpoint.

## Architecture overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              React SPA (:5173)                           │
│  Login · Signup · Dashboard · Projects · Members · Workflows ·          │
│  Runs · Schedules · API Keys                                             │
└─────────────────────┬────────────────────────────────────────────────────┘
                      │  fetch()
┌─────────────────────▼────────────────────────────────────────────────────┐
│                        NestJS API (:3000)                                │
│  Auth · Orgs · Projects · Workflows · Runs · Schedules · Triggers       │
│  API Keys · Audit · Swagger /api/docs · Metrics /api/metrics            │
│                                                                          │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │            Transactional Outbox (same DB transaction)           │     │
│  │  workflow_runs + step_runs + outbox_events  ← single write      │     │
│  └──────────────────────────┬──────────────────────────────────────┘     │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │  outbox_events (JSONB payload)
            ┌─────────────────▼───────────────────────┐
            │           PostgreSQL                     │
            │  organizations · projects · workflows   │
            │  runs · step_runs · api_keys · schedules│
            │  audit_logs · sessions · idempotency    │
            │  keys · outbox_events · worker_leases   │
            └─────────────────▲───────────────────────┘
                              │  row locks (FOR UPDATE SKIP LOCKED)
            ┌─────────────────┴───────────────────────┐
            │                 Redis                    │
            │  flowforge:run / flowforge:step          │
            │  worker heartbeats · worker:lease locks  │
            │  rate-limit counters                     │
            └─────────────────▲───────────────────────┘
                              │  outbox relay (publish → mark claimed)
┌─────────────────────────────┴────────────────────────────────────────────┐
│                         Worker Process                                    │
│  outbox relay · run consumer · step executor pool · reconciler          │
│  · schedule ticker · heartbeats                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite, zustand, React Router |
| Backend | NestJS on Fastify (Node ≥ 20), TypeScript |
| Engine | Custom transactional state machine (`packages/engine`) |
| Database | PostgreSQL (source of truth) |
| Queue/Locks | Redis 7 |
| Validation | Zod (shared schemas across web, API, engine) |
| Docs/API | @nestjs/swagger (OpenAPI) |
| Observability | prom-client, @nestjs/terminus |
| Package manager | pnpm (workspaces, pinned 10.23.0) |
| Deployment | Docker (multi-target `api`/`worker`/`web`), docker-compose |

## How FlowForge works

1. **You define a workflow** — a name and an ordered list of steps. Each step
   has a `type`, a `config`, optional `dependsOn` dependencies, and an optional
   retry policy. Workflows are versioned; published versions are immutable and
   the only ones runnable.
2. **You trigger a run** — via the API with a scoped API key (+ an idempotency
   key), an unauthenticated webhook, or a cron schedule.
3. **The API writes atomically** — the run, its initial `step_runs`, and an
   `outbox_events` row are inserted in **one DB transaction**.
4. **The outbox relay publishes** — it polls `outbox_events`, publishes
   `flowforge:run` wake-ups to Redis, then marks rows claimed.
5. **A worker executes the DAG** — it claims the run with a row lock, reads the
   published workflow version, and schedules ready steps. Steps that pass (or
   exhaust retries) are recorded via the state machine in `packages/engine`.
6. **Long steps are lease-protected** — an in-flight step writes a `worker_leases`
   row with a TTL and heartbeats; if a worker dies, the reconciler recovers the
   expired lease and re-queues the step.
7. **You inspect** every transition, retry a failed run, or cancel a stuck one
   from the UI or API.

## Quick start

### Prerequisites

- **Node.js ≥ 20** (`.nvmrc` pins the recommended version)
- **pnpm 10.23.0+** (`corepack enable` will use the pinned version)
- **Docker** (for PostgreSQL + Redis) and **Git**

### 1. Clone and install

```bash
git clone https://github.com/PrinceInTech/flowforge.git
cd flowforge
corepack enable
pnpm install --frozen-lockfile
```

### 2. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 3. Configure

```bash
cp .env.example .env
# defaults work with the local docker postgres/redis
```

### 4. Build, migrate, seed, and run

```bash
pnpm build
pnpm migrate
pnpm seed
pnpm dev
```

- API → http://localhost:3000
- Swagger → http://localhost:3000/api/docs
- Web UI → http://localhost:5173

### Demo instructions

`pnpm seed` creates a demo organization, project, workflow, and user:

| Field | Value |
|-------|-------|
| Email | `demo@flowforge.dev` |
| Password | `flowforge-demo` |
| API Key | printed once by the seed script (`ff_...`) |

The login page can prefill these demo credentials, controlled by the
`VITE_DEMO_CREDENTIALS` build-time flag (see [Docker deployment](#docker-deployment)
and [Environment variables](#environment-variables)).

## Docker Compose setup

```bash
docker compose up -d --build      # builds and starts postgres, redis, api, worker, web
docker compose exec api pnpm migrate && docker compose exec api pnpm seed   # one-time schema + demo data
```

The compose file reads `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, and
`JWT_REFRESH_SECRET` from the host environment, falling back to clearly-marked
**development-only** defaults. Export real values (or provide an `.env` consumed
by compose) before any public deployment:

```bash
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export JWT_ACCESS_SECRET="$(openssl rand -hex 32)"
export JWT_REFRESH_SECRET="$(openssl rand -hex 32)"
docker compose up -d --build
```

## Local development setup

```bash
docker compose up -d postgres redis   # infra only, no application containers
pnpm install --frozen-lockfile
pnpm build                            # builds workspace packages in order
pnpm migrate                          # runs schema migrations (uses ts-node)
pnpm seed                             # optional demo data
pnpm dev                              # starts API (:3000), worker, and web (:5173)
```

`VITE_*` variables are compiled into the SPA **at build time** — to change the
web UI's API URL you must rebuild the web app, not restart the container.

## Environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://flowforge:flowforge@localhost:5432/flowforge` |
| `DB_SSL` | Enable TLS for the DB connection | `false` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | JWT signing secrets (random in prod) | `dev-access-secret-change-me` / `dev-refresh-secret-change-me` |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | Token lifetimes (seconds) | `900` / `604800` |
| `CORS_ORIGIN` | Allowed web origin for the SPA | `http://localhost:5173` |
| `WEBHOOK_BASE_URL` | Base URL used when presenting webhook URLs | `http://localhost:3000` |
| `PUBLIC_WEB_URL` | Public URL of the SPA | `http://localhost:5173` |
| `RATE_LIMIT_WINDOW_SECONDS` | Fixed-window length for rate limits | `60` |
| `RATE_LIMIT_MAX_LOGIN` | Max login attempts per window per email | `10` |
| `RATE_LIMIT_MAX_SIGNUP` | Max signup attempts per window per IP | `5` |
| `RATE_LIMIT_MAX_WEBHOOK` | Max webhook triggers per window | `60` |
| `RATE_LIMIT_MAX_API_KEY` | Max API-key requests per window | `120` |
| `WORKER_CONCURRENCY` | Concurrent step executions per worker | `8` |
| `STEP_LEASE_SECONDS` | Lease TTL for in-flight steps | `120` |
| `SCHEDULER_INTERVAL_MS` | Schedule ticker interval | `5000` |
| `RECONCILER_INTERVAL_MS` | Lease-recovery reconciler interval | `15000` |
| `OUTBOX_RELAY_INTERVAL_MS` | Outbox relay poll interval | `1000` |
| `VITE_API_URL` | API base URL baked into the SPA build | `http://localhost:3000` |
| `VITE_DEMO_CREDENTIALS` | Prefill demo credentials on the login page (demo-only) | `false` |

## API / Swagger documentation

An OpenAPI spec is served by the running API at **http://localhost:3000/api/docs**
(use `/api/docs-json` for the raw spec). All org-scoped routes require the
`X-Organization-Id` header (obtained from `/api/auth/session`), and most
mutation/read routes require an `Authorization: Bearer <token>` or a scoped
API key.

```bash
# Sign up
curl -X POST http://localhost:3000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret123"}'

# Sign in → returns { user, organizations, tokens }
curl -X POST http://localhost:3000/api/auth/signin \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret123"}'

# Trigger a run with an API key
curl -X POST http://localhost:3000/api/v1/trigger \
  -H "Authorization: Bearer ff_...your_key..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: my-first-trigger" \
  -d '{"workflowId":"<workflowDefinitionId>","payload":{"name":"World"}}'

# Trigger via webhook (unauthenticated)
curl -X POST http://localhost:3000/api/webhooks/<workflowDefinitionId> \
  -H "Content-Type: application/json" \
  -d '{"event":"push","ref":"main"}'

# Poll run status
curl -H "Authorization: Bearer <token>" \
     -H "X-Organization-Id: <orgId>" \
     http://localhost:3000/api/runs/<runId>
```

## Example workflow

Workflows are JSON `{ name, steps[] }` documents. A step references the steps
it depends on via `dependsOn`. Here is a POST-then-transform example:

```json
{
  "name": "Welcome email on signup",
  "description": "Fires on the signup webhook, formats a greeting, and notifies a service.",
  "steps": [
    {
      "id": "send-request",
      "name": "Call tracking endpoint",
      "type": "HTTP_REQUEST",
      "config": {
        "url": "https://httpbin.org/anything",
        "method": "POST",
        "body": { "event": "{{ event }}", "ref": "{{ ref }}" },
        "timeoutMs": 15000
      },
      "retryPolicy": { "maxRetries": 3, "backoffMs": 1000, "maxBackoffMs": 30000 }
    },
    {
      "id": "format-greeting",
      "name": "Greet the user",
      "type": "TRANSFORM",
      "dependsOn": ["send-request"],
      "config": { "template": "Hello {{ name }} — event {{ event }} received", "outputMode": "text" }
    },
    {
      "id": "wait-and-finish",
      "name": "Cooldown delay",
      "type": "DELAY",
      "dependsOn": ["format-greeting"],
      "config": { "durationMs": 2000 }
    }
  ]
}
```

Load it in the UI's workflow editor, publish the version, then trigger it with
the webhook URL from the API reference above.

## Testing

```bash
# Lint and typecheck
pnpm lint
pnpm typecheck

# Unit tests — shared (vitest), engine (vitest), api (jest)
pnpm test

# End-to-end with real PostgreSQL + Redis + a running worker
docker compose up -d               # all containers
pnpm migrate && pnpm seed
pnpm test:e2e
```

CI runs all of the above with a frozen lockfile on every push/PR
(see [.github/workflows/ci.yml](.github/workflows/ci.yml)).

## Project structure

| Path | Description |
|------|-------------|
| `packages/shared` | Types, Zod schemas, constants, DAG validation, retry helpers |
| `packages/engine` | Transactional state machine (`createRun`, `claimStep`, `retry`, `cancel`, lease recovery) |
| `apps/api` | NestJS + Fastify REST API (auth, orgs, projects, workflows, runs, schedules, triggers, API keys, audit) |
| `apps/worker` | Outbox relay, run consumers, step executor pool, reconciler, schedule ticker |
| `apps/web` | React 18 + Vite SPA (zustand state, login/signup, dashboard, editors) |
| `Dockerfile` | Multi-stage build with `api`, `worker`, `web` targets |
| `docker-compose.yml` | Postgres + Redis + API + worker + web for local/demo use |

## Security notes

- Passwords are stored as **salted SHA-256** hashes; JWTs are signed with
  separate access/refresh secrets and rotate via a refresh flow.
- API keys are stored hashed and support scoping to a project with independent
  rate limits.
- Rate limiting is applied per email (login), per IP (signup), and per key or
  workflow (triggers).
- RBAC guards (`OWNER`/`DEVELOPER`/`VIEWER`) protect org-sensitive routes —
  e.g. only owners can change member roles; running, retrying, and cancelling
  runs is restricted to owners and developers.
- Helmet security headers are applied (with CSRF/CSP handled as noted in
  [Known limitations](#known-limitations)); HSTS is only emitted over HTTPS.

## Known limitations

- **Webhook signing (HMAC) is not implemented** — public webhook URLs are
  unauthenticated. Restrict them to non-sensitive events or protect them at the
  ingress layer.
- **CSP is disabled** for the SPA to allow cross-origin API calls; keep
  `CORS_ORIGIN` locked down in production.
- **HSTS requires TLS** — terminate HTTPS at your proxy/ingress so the
  `Strict-Transport-Security` header (which Helmet emits only over HTTPS) is honored.
- **Frontend session expiry** does not auto-redirect to login; an expired token
  surfaces as a request error.
- Other operational limitations are tracked in [SECURITY.md](SECURITY.md).

## Roadmap

- Webhook signature verification (HMAC) and per-tenant signing keys.
- Password hashing upgrade to a memory-hard KDF (argon2id / bcrypt) with hash
  migration for existing users.
- CSP with author-supplied policy in place of the current disabled state.
- Branching/parallelism control on step fan-out and explicit step inputs
  (currently steps share the run payload).
- Optional object storage for large step payloads.
- Automatic session-expiry handling in the SPA.
- Kubernetes manifests / Helm chart for production deployments.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), and
note all participants are expected to follow the
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security issues should be reported
per the instructions in [SECURITY.md](SECURITY.md) — **not** in public issues.

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into the outbox, leases,
and the state machine, and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

MIT © 2026 [Prince Goyal](LICENSE)