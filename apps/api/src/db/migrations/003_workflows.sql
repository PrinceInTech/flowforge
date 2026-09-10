-- ============================================================
-- Workflow definitions, versions, and schedules
-- ============================================================

CREATE TABLE workflow_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  latest_version  INTEGER NOT NULL DEFAULT 0,
  latest_version_id UUID,
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_workflow_defs_project ON workflow_definitions (project_id);
CREATE INDEX idx_workflow_defs_org ON workflow_definitions (organization_id);
CREATE INDEX idx_workflow_defs_name ON workflow_definitions (name);

CREATE TABLE workflow_versions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  version               INTEGER NOT NULL,
  definition            JSONB NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('DRAFT', 'PUBLISHED', 'SUPERSEDED')),
  created_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_definition_id, version)
);

CREATE INDEX idx_workflow_versions_def ON workflow_versions (workflow_definition_id);

CREATE TABLE workflow_schedules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_definition_id UUID NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  workflow_version_id   UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  cron                  TEXT NOT NULL,
  timezone              TEXT NOT NULL DEFAULT 'UTC',
  enabled               BOOLEAN NOT NULL DEFAULT TRUE,
  payload               JSONB NOT NULL DEFAULT '{}'::jsonb,
  next_run_at           TIMESTAMPTZ,
  last_run_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedules_org ON workflow_schedules (organization_id);
CREATE INDEX idx_schedules_enabled_next ON workflow_schedules (enabled, next_run_at);

CREATE TRIGGER trg_workflow_defs_updated_at BEFORE UPDATE ON workflow_definitions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_workflow_versions_updated_at BEFORE UPDATE ON workflow_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_schedules_updated_at BEFORE UPDATE ON workflow_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();