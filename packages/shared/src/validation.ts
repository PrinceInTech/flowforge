import { z } from "zod";
import { ORG_ROLE, STEP_TYPE } from "./constants";

// ============================================================
// Auth
// ============================================================

export const SignUpSchema = z.object({
  email: z.string().email().max(320).transform((s) => s.toLowerCase()),
  password: z.string().min(10).max(256),
  name: z.string().min(1).max(128).optional(),
});

export const SignInSchema = z.object({
  email: z.string().email().max(320).transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(256),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(20).max(4096),
});

// ============================================================
// Organizations
// ============================================================

export const CreateOrganizationSchema = z.object({
  name: z.string().min(2).max(128),
});

export const UpdateMemberRoleSchema = z.object({
  role: ORG_ROLE,
});

export const InviteMemberSchema = z.object({
  email: z.string().email().max(320).transform((s) => s.toLowerCase()),
  role: ORG_ROLE,
});

// ============================================================
// Projects
// ============================================================

export const CreateProjectSchema = z.object({
  name: z.string().min(2).max(128),
  description: z.string().max(2000).optional(),
});

// ============================================================
// Workflows
// ============================================================

export const CreateWorkflowSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  projectId: z.string().min(1).max(64),
});

const WorkflowDefinitionObject = z
  .object({
    name: z.string().min(1).max(256),
    description: z.string().max(2000).optional(),
    steps: z.array(
      z.object({
        id: z.string().min(1).max(128),
        name: z.string().min(1).max(256),
        type: STEP_TYPE,
        dependsOn: z.array(z.string().min(1)).default([]),
        config: z.unknown(),
        timeoutMs: z.number().int().min(1).max(600_000).default(120_000),
        retryPolicy: z
          .object({
            maxRetries: z.number().int().min(0).max(10).default(3),
            backoffMs: z.number().int().min(1).max(600_000).default(1_000),
            maxBackoffMs: z
              .number()
              .int()
              .min(1)
              .max(600_000)
              .default(60_000),
          })
          .optional()
          .default({ maxRetries: 3, backoffMs: 1_000, maxBackoffMs: 60_000 }),
      }),
    ),
  })
  .refine((d) => d.steps.length > 0, {
    message: "Workflow must define at least one step",
  });

export const PublishWorkflowSchema = z.object({
  definition: WorkflowDefinitionObject,
  draftVersionId: z.string().min(1).max(64).optional(),
});

export const SaveDraftSchema = z
  .object({
    workflowId: z.string().min(1).max(64).optional(),
    projectId: z.string().min(1).max(64).optional(),
    definition: WorkflowDefinitionObject,
  })
  .refine((d) => Boolean(d.workflowId) || Boolean(d.projectId), {
    message: "Either workflowId or projectId is required",
  });

// ============================================================
// Runs
// ============================================================

export const TriggerRunSchema = z.object({
  workflowId: z.string().min(1).max(64),
  payload: z.unknown().optional().default({}),
});

export const RunListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .union([
      z.literal("PENDING"),
      z.literal("QUEUED"),
      z.literal("RUNNING"),
      z.literal("COMPLETED"),
      z.literal("FAILED"),
      z.literal("CANCELLED"),
      z.literal("DEAD_LETTER"),
    ])
    .optional(),
  workflowId: z.string().min(1).max(64).optional(),
  trigger: z
    .union([
      z.literal("MANUAL"),
      z.literal("API_KEY"),
      z.literal("WEBHOOK"),
      z.literal("SCHEDULE"),
    ])
    .optional(),
  projectId: z.string().min(1).max(64).optional(),
});

// ============================================================
// API Keys
// ============================================================

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  projectId: z.string().min(1).max(64),
});

// ============================================================
// Schedules
// ============================================================

export const CreateScheduleSchema = z.object({
  workflowId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
  name: z.string().min(1).max(256),
  cron: z.string().min(1).max(128),
  timezone: z.string().min(1).max(64).default("UTC"),
  enabled: z.boolean().default(true),
  payload: z.unknown().optional().default({}),
});

export const UpdateScheduleSchema = z.object({
  cron: z.string().min(1).max(128).optional(),
  timezone: z.string().min(1).max(64).optional(),
  name: z.string().min(1).max(256).optional(),
  enabled: z.boolean().optional(),
  payload: z.unknown().optional(),
});

// ============================================================
// Webhooks
// ============================================================

export const WebhookTriggerSchema = z.object({
  payload: z.unknown().optional().default({}),
});

// ============================================================
// Shared
// ============================================================

export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._-]+$/);

export const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type SignUpInput = z.infer<typeof SignUpSchema>;
export type SignInInput = z.infer<typeof SignInSchema>;
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;
export type InviteMemberInput = z.infer<typeof InviteMemberSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type CreateWorkflowInput = z.infer<typeof CreateWorkflowSchema>;
export type PublishWorkflowInput = z.infer<typeof PublishWorkflowSchema>;
export type SaveDraftInput = z.infer<typeof SaveDraftSchema>;
export type TriggerRunInput = z.infer<typeof TriggerRunSchema>;
export type RunListQuery = z.infer<typeof RunListQuerySchema>;
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
export type CreateScheduleInput = z.infer<typeof CreateScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof UpdateScheduleSchema>;