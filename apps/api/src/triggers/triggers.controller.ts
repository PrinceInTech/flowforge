import {
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { RunsService } from "../runs/runs.service";
import { AuditService } from "../audit/audit.service";
import { ApiKeyGuard } from "../api-keys/api-keys.guard";
import { OrganizationGuard } from "../common/organization.guard";
import { RedisService } from "../redis/redis.service";
import { DatabaseService } from "../db/database.service";
import { Public } from "../common/decorators";
import { ApiError } from "../common/errors";
import { IdempotencyKeySchema } from "@flowforge/shared";

/**
 * Publicly reachable trigger endpoints. The API-key trigger authenticates with
 * `Authorization: Bearer ff_...`; the webhook trigger identifies its workflow by
 * UUID and is rate limited per-IP. Both honour the `Idempotency-Key` header and
 * persist the original request payload.
 */
@ApiTags("triggers")
@Controller("api")
export class TriggersController {
  constructor(
    private readonly runs: RunsService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
  ) {}

  @HttpCode(202)
  @Public()
  @Post("v1/trigger")
  @UseGuards(ApiKeyGuard, OrganizationGuard)
  @ApiOperation({ summary: "Trigger a workflow with a project API key" })
  async triggerWithApiKey(@Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    const apiKeyTenant = meta.apiKeyTenant as { keyId: string; projectId: string; organizationId: string };

    const { allowed } = await this.redis.rateLimit(
      `flowforge:rl:apikey:${apiKeyTenant.keyId}`,
      parseInt(process.env.RATE_LIMIT_MAX_API_KEY ?? "120", 10),
      parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10),
    );
    if (!allowed) throw ApiError.tooManyRequests("API key rate limit exceeded");

    const body = (req.body ?? {}) as { workflowId?: string; payload?: unknown };
    if (!body.workflowId) {
      throw ApiError.badRequest("workflowId is required");
    }

    const idempotencyKey = (req.headers["idempotency-key"] as string) ?? undefined;
    if (idempotencyKey) {
      const parsed = IdempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsed.success) {
        throw ApiError.badRequest("Idempotency-Key is invalid");
      }
    }

    const result = await this.runs.trigger({
      organizationId: apiKeyTenant.organizationId,
      projectId: apiKeyTenant.projectId,
      workflowId: body.workflowId,
      payload: body.payload ?? {},
      trigger: "API_KEY",
      idempotencyKey,
      scope: "WORKFLOW_RUN",
    });

    await this.audit.record({
      organizationId: apiKeyTenant.organizationId,
      projectId: apiKeyTenant.projectId,
      userId: null,
      action: "WORKFLOW_RUN_API_KEY_TRIGGERED",
      entityType: "WORKFLOW_RUN",
      entityId: result.runId,
      metadata: { workflowId: body.workflowId, apiKeyId: apiKeyTenant.keyId },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      runId: result.runId,
      status: result.status,
      duplicate: result.duplicate,
    };
  }

  @HttpCode(202)
  @Public()
  @Post("webhooks/:workflowId")
  @ApiOperation({ summary: "Trigger the latest published version via webhook", description: "Rate limited per IP. Uses Idempotency-Key for safe replays." })
  async webhook(
    @Param("workflowId") workflowId: string,
    @Req() req: FastifyRequest,
  ) {
    const ip = req.ip ?? "unknown";
    const { allowed } = await this.redis.rateLimit(
      `flowforge:rl:webhook:${ip}`,
      parseInt(process.env.RATE_LIMIT_MAX_WEBHOOK ?? "60", 10),
      parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10),
    );
    if (!allowed) throw ApiError.tooManyRequests("Webhook rate limit exceeded");

    // Webhook bodies are arbitrary JSON — accept anything, persist the raw value.
    const payload = req.body ?? {};

    const idempotencyKey = (req.headers["idempotency-key"] as string) ?? undefined;
    if (idempotencyKey) {
      const parsed = IdempotencyKeySchema.safeParse(idempotencyKey);
      if (!parsed.success) {
        throw ApiError.badRequest("Idempotency-Key is invalid");
      }
    }

    const def = await this.workflowTenant(workflowId);
    if (!def) throw ApiError.notFound("Workflow not found");

    const result = await this.runs.trigger({
      organizationId: def.organizationId,
      projectId: def.projectId,
      workflowId,
      payload,
      trigger: "WEBHOOK",
      idempotencyKey,
      scope: "WEBHOOK_RUN",
    });

    await this.audit.record({
      organizationId: def.organizationId,
      projectId: def.projectId,
      userId: null,
      action: "WORKFLOW_RUN_WEBHOOK_TRIGGERED",
      entityType: "WORKFLOW_RUN",
      entityId: result.runId,
      metadata: { workflowId },
      ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      runId: result.runId,
      status: result.status,
      duplicate: result.duplicate,
    };
  }

  private async workflowTenant(workflowId: string) {
    const { rows } = await this.db.query(
      `SELECT organization_id, project_id FROM workflow_definitions WHERE id = $1`,
      [workflowId],
    );
    return rows[0] ?? null;
  }
}