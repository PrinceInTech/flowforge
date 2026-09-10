import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { SchedulesService } from "./schedules.service";
import { OrganizationGuard } from "../common/organization.guard";
import { RequireRole } from "../common/decorators";
import { CurrentUser } from "../common/user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CreateScheduleSchema, UpdateScheduleSchema } from "@flowforge/shared";

@ApiTags("schedules")
@Controller("api/schedules")
@UseGuards(OrganizationGuard)
export class SchedulesController {
  constructor(private readonly service: SchedulesService) {}

  @Get()
  @ApiOperation({ summary: "List cron schedules", description: "Optional ?projectId= filter." })
  async list(@Query() query: { projectId?: string }, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.list(meta.organizationId as string, query.projectId);
  }

  @HttpCode(201)
  @Post()
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Create a cron schedule for a published workflow" })
  async create(
    @Body(new ZodValidationPipe(CreateScheduleSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as {
      workflowId: string;
      name: string;
      cron: string;
      timezone: string;
      enabled: boolean;
      payload?: unknown;
      projectId?: string;
    };
    const meta = req as unknown as Record<string, unknown>;
    if (!input.projectId) throw new TypeError("projectId is required");
    return this.service.create({
      organizationId: meta.organizationId as string,
      projectId: input.projectId,
      workflowId: input.workflowId,
      name: input.name,
      cron: input.cron,
      timezone: input.timezone,
      enabled: input.enabled,
      payload: input.payload,
      userId: user.userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Patch(":scheduleId")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Update a schedule (rename, cron, enable/disable)" })
  async update(
    @Param("scheduleId") scheduleId: string,
    @Body(new ZodValidationPipe(UpdateScheduleSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as {
      cron?: string;
      timezone?: string;
      name?: string;
      enabled?: boolean;
      payload?: unknown;
    };
    const meta = req as unknown as Record<string, unknown>;
    return this.service.update({
      scheduleId,
      organizationId: meta.organizationId as string,
      cron: input.cron,
      timezone: input.timezone,
      name: input.name,
      enabled: input.enabled,
      payload: input.payload,
      userId: user.userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @HttpCode(204)
  @Delete(":scheduleId")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Delete a schedule" })
  async remove(@Param("scheduleId") scheduleId: string, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    await this.service.remove(scheduleId, meta.organizationId as string);
    return;
  }
}