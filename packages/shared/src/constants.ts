import { z } from "zod";

export const STEP_TYPE = z.enum(["HTTP_REQUEST", "DELAY", "TRANSFORM"]);

export const WORKFLOW_RUN_STATUS = z.enum([
  "PENDING",
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);

export const STEP_RUN_STATUS = z.enum([
  "PENDING",
  "READY",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "DEAD_LETTER",
]);

export const ORG_ROLE = z.enum(["OWNER", "DEVELOPER", "VIEWER"]);

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const AUDIT_ACTIONS = [
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
] as const;

export const QUEUE_NAMES = {
  WORKFLOW_RUN: "flowforge:run",
  STEP_RUN: "flowforge:step",
} as const;

export const REDIS_KEYS = {
  IDEMPOTENCY_PREFIX: "flowforge:idem",
  RATE_LIMIT_PREFIX: "flowforge:rl",
  SCHEDULE_LOCK_PREFIX: "flowforge:sched:lock",
  BACKLOG_KEY: "flowforge:backlog",
} as const;

export const OUTBOX_EVENT_TYPES = ["RUN_READY", "STEP_READY"] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

export const RUN_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "DEAD_LETTER"],
  COMPLETED: [],
  FAILED: ["QUEUED", "DEAD_LETTER"],
  CANCELLED: [],
  DEAD_LETTER: ["QUEUED"],
};

export const STEP_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["READY", "CANCELLED"],
  READY: ["RUNNING", "CANCELLED"],
  RUNNING: ["COMPLETED", "FAILED", "CANCELLED", "DEAD_LETTER"],
  COMPLETED: [],
  FAILED: ["READY", "DEAD_LETTER"],
  CANCELLED: [],
  DEAD_LETTER: ["READY"],
};