-- ============================================================
-- Runs: workflow runs, step runs, idempotency keys
-- ============================================================

CREATE TYPE workflow_run_status AS ENUM (
  'PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'
);

CREATE TYPE step_run_status AS ENUM (
  'PENDING', 'READY', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'DEAD_LETTER'
);

CREATE TYPE run_trigger AS ENUM ('MANUAL', 'API_KEY', 'WEBHOOK', 'SCHEDULE');

CREATE TABLE workflow_runs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  workflow_version_id   UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  run_number            INTEGER NOT NULL DEFAULT 0,
  trigger               run_trigger NOT NULL,
  status                workflow_run_status NOT NULL DEFAULT 'PENDING',
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message         TEXT,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_by_user_email TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_runs_org_created ON workflow_runs (organization_id, created_at DESC);
CREATE INDEX idx_runs_project_created ON workflow_runs (project_id, created_at DESC);
CREATE INDEX idx_runs_status ON workflow_runs (status);
CREATE INDEX idx_runs_workflow ON workflow_runs (workflow_definition_id, created_at DESC);
CREATE INDEX idx_runs_version ON workflow_runs (workflow_version_id);

CREATE TABLE step_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id      UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  workflow_version_id  UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  step_id              TEXT NOT NULL,
  step_name            TEXT NOT NULL,
  step_type            TEXT NOT NULL CHECK (step_type IN ('HTTP_REQUEST', 'DELAY', 'TRANSFORM')),
  step_config          JSONB NOT NULL,
  status               step_run_status NOT NULL DEFAULT 'PENDING',
  attempt              INTEGER NOT NULL DEFAULT 0,
  max_retries          INTEGER NOT NULL DEFAULT 0,
  input                JSONB,
  output               JSONB,
  logs                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message        TEXT,
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  lease_expires_at     TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_step_runs_run ON step_runs (workflow_run_id);
CREATE INDEX idx_step_runs_run_status ON step_runs (workflow_run_id, status);
CREATE INDEX idx_step_runs_ready ON step_runs (status, lease_expires_at) WHERE status = 'READY';
CREATE INDEX idx_step_runs_running_lease ON step_runs (status, lease_expires_at) WHERE status = 'RUNNING';

CREATE TABLE idempotency_keys (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id           UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope                TEXT NOT NULL CHECK (scope IN ('WORKFLOW_RUN', 'WEBHOOK_RUN')),
  key                  TEXT NOT NULL,
  request_hash         TEXT NOT NULL,
  workflow_run_id      UUID REFERENCES workflow_runs(id) ON DELETE SET NULL,
  request_payload      JSONB,
  response_run_id      UUID,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at           TIMESTAMPTZ NOT NULL,
  UNIQUE (scope, key)
);

CREATE INDEX idx_idem_expiry ON idempotency_keys (expires_at);

CREATE TABLE audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
  action          TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip              TEXT,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org_created ON audit_logs (organization_id, created_at DESC);
CREATE INDEX idx_audit_user_created ON audit_logs (user_id, created_at DESC);

CREATE TRIGGER trg_runs_updated_at BEFORE UPDATE ON workflow_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_step_runs_updated_at BEFORE UPDATE ON step_runs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();