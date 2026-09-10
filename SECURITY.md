# Security Policy

FlowForge takes the security of its users and their data seriously. This
document describes how to report vulnerabilities and summarizes the security
model the project ships with.

## Supported versions

| Version | Supported          |
|---------|--------------------|
| 1.0.x   | :white_check_mark: |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report private security issues via GitHub's private vulnerability
reporting (Security → Security advisories → New draft security advisory), or
email the maintainers directly if you have their contact coordinates.

Please include:

- The affected version(s) and commit hash if known.
- A minimal reproduction: steps, payloads, and the environment.
- Impact assessment: what an attacker could realistically do.

You should receive an acknowledgment within 72 hours. After a triage, we will
coordinate a fix and disclosure timeline with you.

## Security model

- PostgreSQL is the source of truth; Redis only carries queues, locks, and
  rate-limit counters — no durable state.
- All SQL is parameterized (`pg` prepared-style queries) — no string-built SQL.
- AuthN is JWT (access + refresh, salted SHA-256 password hashing); all routes
  are protected by a global `JwtAuthGuard` unless explicitly marked public
  (health, signin, signup, webhook triggers).
- AuthZ is org-scoped: every scenario executes against the org from the
  validated `X-Organization-Id` header, with `OWNER`/`DEVELOPER`/`VIEWER`
  role gates on mutating endpoints.
- Idempotency keys and transactional outbox provide at-least-once delivery with
  idempotent consumers, so duplicated messages never double-execute business
  logic.
- The `TRANSFORM` step type uses `{{ field.path }}` template interpolation only —
  no `eval()`, no `new Function()`, no user-supplied code execution.
- Rate limiting (Redis fixed-window) on signin and signup-per-IP endpoints,
  plus JWT secret rotation guidance in the docs.
- Security headers (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, HSTS when behind HTTPS) are applied via `@fastify/helmet`.

## Known limitations

- Passwords are hashed with salted SHA-256. This is fast to compute; a
  memory-hard KDF (argon2id / bcrypt) with a migration path is recommended for
  production deployments handling high-value credentials.
- Webhook trigger endpoints do not sign payloads with HMAC. Do not expose them
  to untrusted networks without an API gateway signature/token mechanism.
- When running purely over HTTP, HSTS is disabled by `@fastify/helmet` (it only
  sets HSTS on HTTPS responses), and transport security is delegated to your
  ingress/reverse proxy. Terminate TLS there.
- SPA API calls are cross-origin (CORS); the default CSP stays disabled. If you
  re-enable it, author your own directives.

## Production deployment checklist

- Generate strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` values (>32 random
  bytes each) and override the docker-compose defaults via environment.
- Change the default Postgres password (`flowforge`) and restrict network egress
  to only what the API/worker need.
- Put Postgres, Redis, the API, and the worker on a private network; expose only
  the web UI and/or API through TLS-terminating ingress.
- Enable the audit log retention policy appropriate to your compliance needs.