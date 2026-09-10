export type OrgRole = "OWNER" | "DEVELOPER" | "VIEWER";

export interface User {
  id: string;
  email: string;
  name: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  role?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSession {
  user: User;
  organizations: Organization[];
}

export interface AuthSessionWithTokens extends AuthSession {
  tokens: AuthTokens;
}

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  workflow_count?: number;
  created_at: string;
}

export interface Workflow {
  id: string;
  organization_id: string;
  project_id: string;
  name: string;
  description: string | null;
  latest_version: number;
  latest_version_id: string;
  status: string;
  project_name?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkflowVersion {
  id: string;
  version: number;
  status: string;
  definition: unknown;
  created_by_email?: string;
  created_at: string;
}

export interface WorkflowDetail {
  workflow: {
    id: string;
    name: string;
    description: string | null;
    project_id: string;
    latest_version: number;
    latest_version_id: string;
    status: string;
  };
  versions: WorkflowVersion[];
}

export interface StepRun {
  id: string;
  step_id: string;
  step_name: string;
  step_type: string;
  step_config: unknown;
  status: string;
  attempt: number;
  max_retries: number;
  input: unknown;
  output: unknown;
  logs: Array<{ attempt: number; ts: string; level: string; message: string }>;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface Run {
  id: string;
  project_id: string;
  workflow_definition_id: string;
  workflow_name: string;
  version: number;
  run_number: number;
  trigger: string;
  status: string;
  payload: unknown;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_by_user_email: string | null;
  created_at: string;
}

export interface RunDetail {
  run: {
    id: string;
    project_id: string;
    project_name: string;
    workflow_name: string;
    version: number;
    run_number: number;
    trigger: string;
    status: string;
    payload: unknown;
    error_message: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_by_user_email: string | null;
    created_at: string;
  };
  steps: StepRun[];
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
}

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  workflow_name: string;
  workflow_version: number;
  payload: unknown;
  next_run_at: string | null;
  last_run_at: string | null;
}

export interface OpsMetrics {
  queueBacklog: number;
  activeJobs: number;
  workersUp: number;
  leaseRecoveredTotal: number;
  runsStartedTotal: number;
  runsCompletedTotal: number;
  runsFailedTotal: number;
}

export interface RunStats {
  runs24h: number;
  pendingCount: number;
  queuedCount: number;
  runningCount: number;
  failedCount: number;
  successRate: number;
  avgLatencyMs: number | null;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}