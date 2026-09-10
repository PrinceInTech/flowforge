import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { RunsService } from "./runs.service";
import { AuditService } from "../audit/audit.service";
import { OrganizationGuard } from "../common/organization.guard";
import { RequireRole } from "../common/decorators";
import { CurrentUser } from "../common/user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { TriggerRunSchema, RunListQuerySchema } from "@flowforge/shared";

@ApiTags("runs")
@Controller("api/runs")
@UseGuards(OrganizationGuard)
export class RunsController {
  constructor(
    private readonly service: RunsService,
    private readonly audit: AuditService,
  ) {}

  @HttpCode(202)
  @Post("trigger")
  @ApiOperation({
    summary: "Trigger a workflow run from the dashboard",
    description:
      "Uses the X-Organization-Id header for tenancy. Returns 202 Accepted; execution is asynchronous.",
  })
  async trigger(
    @Body(new ZodValidationPipe(TriggerRunSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string; email: string },
  ) {
    const input = body as { workflowId: string; payload?: unknown };
    const meta = req as unknown as Record<string, unknown>;
    const orgId = meta.organizationId as string;

    if (!input.workflowId) throw new TypeError("workflowId is required");

    const result = await this.service.trigger({
      organizationId: orgId,
      workflowId: input.workflowId,
      payload: input.payload ?? {},
      trigger: "MANUAL",
      createdByUserEmail: user.email,
      scope: "WORKFLOW_RUN",
      idempotencyKey: (req.headers["idempotency-key"] as string) ?? undefined,
    });

    await this.audit.record({
      organizationId: orgId,
      userId: user.userId,
      action: "WORKFLOW_RUN_MANUALLY_TRIGGERED",
      entityType: "WORKFLOW_RUN",
      entityId: result.runId,
      metadata: { workflowId: input.workflowId },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    return {
      runId: result.runId,
      status: result.status,
      duplicate: result.duplicate,
      message: result.duplicate
        ? "Duplicate request — returning the original run"
        : "Run accepted",
    };
  }

  @Get()
  @ApiOperation({ summary: "List runs with filters" })
  async list(
    @Query(new ZodValidationPipe(RunListQuerySchema)) query: unknown,
    @Req() req: FastifyRequest,
  ) {
    const q = query as {
      page: number;
      pageSize: number;
      status?: string;
      workflowId?: string;
      trigger?: string;
      projectId?: string;
    };
    const meta = req as unknown as Record<string, unknown>;
    return this.service.list({
      organizationId: meta.organizationId as string,
      projectId: q.projectId,
      page: q.page,
      pageSize: q.pageSize,
      status: q.status,
      workflowId: q.workflowId,
      trigger: q.trigger,
    });
  }

  @Get("stats")
  @ApiOperation({ summary: "Small dashboard statistics" })
  async stats(@Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.dashboardStats(meta.organizationId as string);
  }

  @Get(":runId")
  @ApiOperation({ summary: "Run detail with step runs" })
  async detail(@Param("runId") runId: string, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.getDetail(runId, meta.organizationId as string);
  }

  @HttpCode(202)
  @Post(":runId/retry")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Manually retry a FAILED run in place" })
  async retry(
    @Param("runId") runId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const meta = req as unknown as Record<string, unknown>;
    const result = await this.service.retry(runId, meta.organizationId as string);
    await this.audit.record({
      organizationId: meta.organizationId as string,
      userId: user.userId,
      action: "WORKFLOW_RUN_RETRIED",
      entityType: "WORKFLOW_RUN",
      entityId: runId,
      metadata: {},
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return result;
  }

  @HttpCode(202)
  @Post(":runId/cancel")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Cancel a run that is still in progress" })
  async cancel(
    @Param("runId") runId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const meta = req as unknown as Record<string, unknown>;
    const result = await this.service.cancel(runId, meta.organizationId as string);
    await this.audit.record({
      organizationId: meta.organizationId as string,
      userId: user.userId,
      action: "WORKFLOW_RUN_CANCELLED",
      entityType: "WORKFLOW_RUN",
      entityId: runId,
      metadata: {},
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return result;
  }

  @HttpCode(204)
  @Delete(":runId")
  @ApiOperation({ summary: "Delete a run and its steps" })
  @RequireRole("OWNER", "DEVELOPER")
  async delete(@Param("runId") runId: string, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    await this.service.delete(runId, meta.organizationId as string);
    return;
  }
}
