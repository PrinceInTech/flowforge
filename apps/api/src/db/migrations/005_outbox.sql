-- ============================================================
-- Transactional outbox + worker leases
-- ============================================================

CREATE TABLE outbox_events (
  id             BIGSERIAL PRIMARY KEY,
  event_type     TEXT NOT NULL CHECK (event_type IN ('RUN_READY', 'STEP_READY')),
  entity_type    TEXT NOT NULL,
  entity_id      UUID NOT NULL,
  payload        JSONB NOT NULL,
  available_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outbox_unpublished ON outbox_events (id, published_at, available_at) WHERE published_at IS NULL;

CREATE TABLE worker_leases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id   TEXT NOT NULL,
  lease_type  TEXT NOT NULL CHECK (lease_type IN ('STEP_RUN')),
  target_id   UUID NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (lease_type, target_id)
);

CREATE INDEX idx_leases_expiry ON worker_leases (lease_type, expires_at);