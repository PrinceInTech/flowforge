import { z } from "zod";
import {
  STEP_TYPE,
  WORKFLOW_RUN_STATUS,
  STEP_RUN_STATUS,
} from "./constants";

export type UUID = string;
export type ISODateString = string;

// ============================================================
// Organizations & membership
// ============================================================

export const OrgRoleSchema = z.union([
  z.literal("OWNER"),
  z.literal("DEVELOPER"),
  z.literal("VIEWER"),
]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  role?: OrgRole;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

export interface OrganizationMember {
  id: UUID;
  organizationId: UUID;
  userId: UUID;
  role: OrgRole;
  createdAt: ISODateString;
}

export interface User {
  id: UUID;
  email: string;
  name: string | null;
  createdAt?: ISODateString;
  updatedAt?: ISODateString;
}

// ============================================================
// Projects
// ============================================================

export interface Project {
  id: UUID;
  organizationId: UUID;
  name: string;
  slug: string;
  description: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ============================================================
// API keys
// ============================================================

export interface ApiKey {
  id: UUID;
  organizationId: UUID;
  projectId: UUID;
  name: string;
  prefix: string;
  lastUsedAt: ISODateString | null;
  revokedAt: ISODateString | null;
  createdAt: ISODateString;
}

// ============================================================
// Workflow definitions & steps
// ============================================================

export type StepType = z.infer<typeof STEP_TYPE>;

export const HttpRequestStepConfigSchema = z.object({
  url: z.string().url().describe("Absolute URL to request"),
  method: z
    .union([
      z.literal("GET"),
      z.literal("POST"),
      z.literal("PUT"),
      z.literal("PATCH"),
      z.literal("DELETE"),
    ])
    .default("GET"),
  headers: z
    .record(z.string(), z.string())
    .default({})
    .describe("Static headers sent with the request"),
  body: z.unknown().optional().describe("JSON request body"),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(300_000)
    .default(30_000)
    .describe("Per-request timeout"),
});

export type HttpRequestStepConfig = z.infer<typeof HttpRequestStepConfigSchema>;

export const DelayStepConfigSchema = z.object({
  durationMs: z
    .number()
    .int()
    .min(1)
    .max(86_400_000)
    .describe("How long to sleep, in milliseconds"),
});

export type DelayStepConfig = z.infer<typeof DelayStepConfigSchema>;

/**
 * The TRANSFORM step interpolates `input` fields into a `template` string. This is a
 * deliberately restricted mechanism: no JavaScript, no `eval`, no arbitrary execution.
 * Placeholders use `{{ field.path }}` and are resolved against the step's input object.
 */
export const TransformStepConfigSchema = z.object({
  template: z
    .string()
    .min(1)
    .max(32_768)
    .describe("Output template with {{ path.to.field }} placeholders"),
  outputMode: z
    .union([z.literal("text"), z.literal("json")])
    .default("text")
    .describe("If json, the result is parsed and stored as JSON"),
});

export type TransformStepConfig = z.infer<typeof TransformStepConfigSchema>;

export const StepConfigSchema = z.union([
  HttpRequestStepConfigSchema,
  DelayStepConfigSchema,
  TransformStepConfigSchema,
]);

export type StepConfig = z.infer<typeof StepConfigSchema>;

export const StepSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(256),
  type: STEP_TYPE,
  dependsOn: z.array(z.string().min(1)).default([]),
  config: StepConfigSchema,
  timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
  retryPolicy: z
    .object({
      maxRetries: z.number().int().min(0).max(10).default(3),
      backoffMs: z.number().int().min(1).max(600_000).default(1_000),
      maxBackoffMs: z.number().int().min(1).max(600_000).default(60_000),
    })
    .default({ maxRetries: 3, backoffMs: 1_000, maxBackoffMs: 60_000 }),
});

export type Step = z.infer<typeof StepSchema>;

export const WorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2_000).optional(),
  steps: z.array(StepSchema),
});

export type WorkflowDefinitionInput = z.infer<typeof WorkflowDefinitionSchema>;

export const WorkflowVersionStatusSchema = z.enum([
  "DRAFT",
  "PUBLISHED",
  "SUPERSEDED",
]);

export type WorkflowVersionStatus = z.infer<typeof WorkflowVersionStatusSchema>;

export interface WorkflowVersion {
  id: UUID;
  workflowDefinitionId: UUID;
  version: number;
  definition: WorkflowDefinitionInput;
  status: WorkflowVersionStatus;
  createdByUserId: UUID;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface WorkflowDefinitionSummary {
  id: UUID;
  organizationId: UUID;
  projectId: UUID;
  name: string;
  description: string | null;
  latestVersion: number;
  latestVersionId: UUID;
  status: WorkflowVersionStatus;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ============================================================
// Schedules
// ============================================================

export const CronScheduleSchema = z.object({
  cron: z.string().min(1).max(128),
  timezone: z.string().min(1).max(64).default("UTC"),
});

export type CronScheduleConfig = z.infer<typeof CronScheduleSchema>;

export interface WorkflowSchedule {
  id: UUID;
  workflowDefinitionId: UUID;
  workflowVersionId: UUID;
  projectId: UUID;
  organizationId: UUID;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  payload: unknown;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ============================================================
// Runs
// ============================================================

export const WorkflowRunStatusSchema = WORKFLOW_RUN_STATUS;
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

export const StepRunStatusSchema = STEP_RUN_STATUS;
export type StepRunStatus = z.infer<typeof StepRunStatusSchema>;

export const RunTriggerSchema = z.enum([
  "MANUAL",
  "API_KEY",
  "WEBHOOK",
  "SCHEDULE",
]);

export type RunTrigger = z.infer<typeof RunTriggerSchema>;

export interface StepRun {
  id: UUID;
  workflowRunId: UUID;
  workflowVersionId: UUID;
  stepId: string;
  stepName: string;
  stepType: StepType;
  stepConfig: StepConfig;
  status: StepRunStatus;
  attempt: number;
  maxRetries: number;
  input: unknown;
  output: unknown;
  errorMessage: string | null;
  startedAt: ISODateString | null;
  completedAt: ISODateString | null;
  leaseExpiresAt: ISODateString | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface WorkflowRun {
  id: UUID;
  organizationId: UUID;
  projectId: UUID;
  workflowDefinitionId: UUID;
  workflowVersionId: UUID;
  runNumber: number;
  trigger: RunTrigger;
  status: WorkflowRunStatus;
  payload: unknown;
  errorMessage: string | null;
  startedAt: ISODateString | null;
  completedAt: ISODateString | null;
  createdByUserEmail: string | null;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

// ============================================================
// Audit
// ============================================================

export const AuditActionSchema = z.enum([
  "AUTH_SIGN_UP",
  "AUTH_SIGN_IN",
  "AUTH_SIGN_OUT",
  "AUTH_REFRESH",
  "ORG_CREATED",
  "ORG_MEMBER_INVITED",
  "ORG_MEMBER_ROLE_CHANGED",
  "ORG_MEMBER_REMOVED",
  "PROJECT_CREATED",
  "API_KEY_CREATED",
  "API_KEY_REVOKED",
  "WORKFLOW_PUBLISHED",
  "WORKFLOW_RUN_MANUALLY_TRIGGERED",
  "WORKFLOW_RUN_RETRIED",
  "WORKFLOW_RUN_CANCELLED",
  "WORKFLOW_RUN_WEBHOOK_TRIGGERED",
  "WORKFLOW_RUN_API_KEY_TRIGGERED",
  "SCHEDULE_CREATED",
  "SCHEDULE_UPDATED",
  "SCHEDULE_DISABLED",
]);

export type AuditAction = z.infer<typeof AuditActionSchema>;

export interface AuditLogEntry {
  id: UUID;
  organizationId: UUID | null;
  projectId: UUID | null;
  userId: UUID | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  createdAt: ISODateString;
}

// ============================================================
// API request/response shapes
// ============================================================

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthSession {
  user: User;
  organizations: Organization[];
  tokens: AuthTokens;
}

export interface ApiErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface RunSummary extends WorkflowRun {
  workflowName: string;
  version: number;
}

export type DashboardStats = {
  runs24h: number;
  successRate: number;
  pendingCount: number;
  runningCount: number;
  failedCount: number;
  avgLatencyMs: number | null;
};

export type OperationalMetrics = {
  queueBacklog: number;
  activeJobs: number;
  leaseRecovered: number;
  workers: number;
  stepsCompleted: number;
  stepsFailed: number;
};