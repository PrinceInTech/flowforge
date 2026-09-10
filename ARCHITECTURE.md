# Architecture Deep Dive

This document covers design tradeoffs, failure scenarios, and potential improvements
for the FlowForge workflow orchestration platform.

---

## 1. Transactional Outbox — why not direct Redis publish?

**Problem:** If the API writes a run to PG then publishes a wake-up to Redis, and
the process crashes between those two operations, the wake-up is lost and the run
sits in QUEUED forever.

**Solution:** The outbox pattern writes the wake-up event into the same DB transaction
as the state transition. A separate relay process polls the outbox, publishes to Redis,
and marks the event as delivered via a conditional `UPDATE ... WHERE published_at IS NULL`
(safe for multiple relay instances).

**Tradeoffs:**
- **Pro:** Zero risk of lost wake-ups (at-least-once delivery).
- **Con:** Relay adds 1–2s latency to run start (polling interval).
- **Con:** Slightly more complex code in the transaction functions.

**Alternative considered:** Redis Streams with consumer groups. Simpler, but no
transactional guarantee with PG state changes — requires a two-phase commit or
saga pattern which is harder to reason about.

---

## 2. PostgreSQL as source of truth vs Redis

Redis is used as a **queue + lock service only**. The run status, step outputs, logs,
and all business state live in PG. This means:

- You can run the API without Redis (runs queue in outbox until relay starts).
- You can rebuild Redis state from PG (the reconciler does exactly this).
- No data loss if Redis crashes (data persists in `outbox_events`).

**Why not Redis for state?** Redis is in-memory. Scaling to millions of runs with
retention requires Redis AOF/RDB persistence, which adds operational complexity.
PG handles this natively with WAL, point-in-time recovery, and JSONB for structured
data (logs, payloads).

---

## 3. Worker lease model

Long-running steps (HTTP calls with timeouts, multi-second delays) need to hold a
worker "claim" so the reconciler doesn't reassign them. The model:

1. Worker claims a step_run via `FOR UPDATE` → sets `lease_expires_at = now() + TTL`.
2. Worker heartbeats every `lease/3` seconds (default 40s for a 120s lease) to extend it.
3. If the worker dies, the lease expires, and the reconciler reclaims the step.

**Tradeoffs:**
- **Pro:** No orphaned runs when workers crash.
- **Con:** Heartbeat overhead (one UPDATE per 5s per active step).
- **Con:** After crash, step restarts from scratch (no checkpoint/resume for HTTP calls).

**Future improvement:** For HTTP steps, store partial response data on each chunk
received, so resume can continue from where it left off.

---

## 4. Step type restrictions

### TRANSFORM: template interpolation only

The `TRANSFORM` step uses `{{ field.path }}` placeholders resolved against the step
input. **No arbitrary code execution** — no `eval()`, `new Function()`, or dynamic
`require()`. This is a deliberate security decision:

- Prevents code injection via payload fields.
- Makes step behavior deterministic and auditable.
- Allows static analysis of templates.

**Step input:** a root step (no `dependsOn`) inherits the run payload; a dependent
step receives the outputs of its completed parents keyed by their `id`
(`{{ parentStepId.field }}` or a bare `{{ parentStepId }}` when the output is
scalar). Inputs are written when a step transitions to READY, so templates always
resolve against data that already exists.

**Tradeoff:** Less powerful than Temporal's activity functions. You cannot do complex
transformations in a single step. Workaround: chain multiple TRANSFORM steps with
intermediate outputs.

### HTTP_REQUEST: full HTTP client

Supports GET/POST/PUT/PATCH/DELETE with custom headers and body. The worker uses
`fetch()` (Node 20+ built-in) — no external HTTP library needed.

**Tradeoff:** No connection pooling, no retry at the HTTP level (retries happen at
the step level with backoff). For high-throughput scenarios, a connection pool
(HTTP/2 multiplexing) would be more efficient.

---

## 5. Concurrency model

The worker runs a **fixed pool** of step consumers (`WORKER_CONCURRENCY`, default 8).
Each consumer claims one step at a time:

1. A STEP_READY outbox event is relayed to Redis; a consumer pops it and calls
   `claimStep(stepRunId)` for that specific step.
2. `claimStep` atomically transitions READY → RUNNING (guarded by `FOR UPDATE OF s`)
   and sets lease_expires_at → now + lease. Only READY steps can be claimed, so
   duplicate queue deliveries are ignored. Inputs were already materialized when
   the step became READY (root steps inherit the run payload; dependent steps get
   their parents' outputs).
3. The executor runs the step (HTTP / delay / transform).
4. On success/failure, it records the result in the same transaction.

**Why fixed pool?** Prevents unbounded goroutine-style concurrency that could
overwhelm downstream APIs. The pool size is tunable per deployment.

**Tradeoff:** If all 8 slots are occupied by slow HTTP calls, new steps queue up.
This is intentional — backpressure is a feature, not a bug.

---

## 6. Reconciler

The reconciler runs every 10s and:

1. **Recovers expired leases:** step_runs stuck in RUNNING with expired leases
   are reset to READY (or FAILED after max retries).
2. **Wakes orphaned runs:** runs in QUEUED/RUNNING with no READY or RUNNING steps
   are re-evaluated (in case a step completed but the wake-up was lost).

This is the safety net for at-least-once delivery. Even if the outbox relay
crashes or Redis loses messages, the reconciler ensures progress.

---

## 7. Idempotency

### API-key trigger (`POST /api/v1/trigger`)

- Client sends an `Idempotency-Key` header.
- Server hashes `(key + user_id + payload)` and checks `idempotency_keys` table.
- Same key + same payload → returns the original run (idempotent).
- Same key + different payload → 409 Conflict.

### Duplicate outbox delivery

- Outbox relay polls unpublished `outbox_events` rows, `RPUSH`es the payload to a
  Redis LIST (`flowforge:run` / `flowforge:step`), then conditionally marks
  `published_at` so the event is never delivered twice by the relay itself.
- If the relay crashes between the `RPUSH` and the `published_at` update, the
  next poll re-publishes the message — a benign duplicate, never a loss.
- Consumer receives duplicate → checks step_run status → ignores if already RUNNING/COMPLETED.

---

## 8. Scheduler

`SchedulerService` runs in every API replica:

1. Acquires a Redis lock (`SET NX EX 3`).
2. Queries due schedules with `FOR UPDATE SKIP LOCKED`.
3. For each due schedule: creates a run, advances `next_run_at`, releases the row lock.

**Why `FOR UPDATE SKIP LOCKED`?** Multiple API replicas may tick simultaneously.
The lock reduces contention but doesn't eliminate it (lock may expire mid-tick).
SKIP LOCKED ensures no two replicas process the same schedule in the same tick.

**Tradeoff:** In rare edge cases (lock expiry during tick), a schedule may fire
twice within the same interval. This is acceptable for most use cases; the
idempotency layer prevents duplicate runs from the same trigger source.

---

## 9. Frontend state management

The SPA uses **zustand** for client state:

- `auth-store.ts`: session tokens, org selector, restore on page reload.
- `projects-store.ts`: project list, selected project (persisted in localStorage).

**Why zustand over Redux/Context?** Zero boilerplate, no providers, tiny bundle.
The app has ~10 pages with simple state — zustand is the right tool.

**Tradeoff:** No server-state caching (React Query / TanStack Query would add
caching and optimistic updates). For this portfolio piece, direct `http.get()`
calls are sufficient.

---

## 10. Known limitations

| Limitation | Impact | Future improvement |
|-----------|--------|-------------------|
| No workflow versioning UI (visual editor) | Users must write JSON | Build a React Flow-based editor |
| No step output streaming | Logs appear after step completes | WebSocket streaming from worker |
| No webhook signature verification | Webhooks can be forged by anyone | Add HMAC signing with shared secret |
| No API-key workflow-level scoping | All keys in a project can trigger any workflow in it | Per-key workflow-level permissions |
| No workflow pause/resume | Long-running workflows can't be paused | Add PAUSED state + step dependency graph |
| No multi-region deployment | Single-region only | PG logical replication + Redis Sentinel |
| No RBAC on API keys | All keys in a project have full access | Per-key workflow-level permissions |

---

## 11. Production readiness checklist

- [ ] Add TLS termination (nginx/Cloudflare)
- [ ] Add Prometheus metrics scraping (already exposing `/api/metrics`)
- [ ] Add structured logging (already JSON; ship to ELK/Datadog)
- [ ] Add PostgreSQL connection pooling (PgBouncer)
- [ ] Add Redis Sentinel/Cluster for HA
- [ ] Add worker autoscaling based on queue depth
- [ ] Add workflow execution timeout at the run level (not just step level)
- [ ] Add audit log retention policy
- [ ] Add SSO/SAML integration for enterprise tenants
