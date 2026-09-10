import {
  BadRequestException,
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
import { WorkflowsService } from "./workflows.service";
import { OrganizationGuard } from "../common/organization.guard";
import { RequireRole } from "../common/decorators";
import { CurrentUser } from "../common/user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CreateWorkflowSchema, PublishWorkflowSchema, SaveDraftSchema } from "@flowforge/shared";
import type { PublishWorkflowInput, SaveDraftInput } from "@flowforge/shared";

@ApiTags("workflows")
@Controller("api/workflows")
@UseGuards(OrganizationGuard)
export class WorkflowsController {
  constructor(private readonly service: WorkflowsService) {}

  @Get()
  @ApiOperation({ summary: "List workflow definitions", description: "Optional ?projectId= filter." })
  async list(
    @Query() query: { projectId?: string },
    @Req() req: FastifyRequest,
  ) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.list(meta.organizationId as string, query.projectId);
  }

  @HttpCode(201)
  @Post()
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Create a new workflow definition" })
  async create(
    @Body(new ZodValidationPipe(CreateWorkflowSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as { name: string; description?: string; projectId?: string };
    const meta = req as unknown as Record<string, unknown>;
    if (!input.projectId) throw new TypeError("projectId is required");
    return this.service.create({
      organizationId: meta.organizationId as string,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      userId: user.userId,
    });
  }

  @Get(":workflowId")
  @ApiOperation({ summary: "Workflow detail including all versions" })
  async detail(@Param("workflowId") workflowId: string, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.getWithVersions(workflowId, meta.organizationId as string);
  }

  @Get(":workflowId/versions/:versionId")
  @ApiOperation({ summary: "A single workflow version with its immutable definition" })
  async version(
    @Param("workflowId") _workflowId: string,
    @Param("versionId") versionId: string,
    @Req() req: FastifyRequest,
  ) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.getVersion(versionId, meta.organizationId as string);
  }

  @HttpCode(202)
  @Post(":workflowId/publish")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({
    summary: "Publish a new immutable version",
    description: "Validates the DAG and creates a new version. Runs always execute a published version snapshot.",
  })
  async publish(
    @Param("workflowId") workflowId: string,
    @Body(new ZodValidationPipe(PublishWorkflowSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as {
      definition: PublishWorkflowInput["definition"];
      draftVersionId?: string;
    };
    const meta = req as unknown as Record<string, unknown>;
    return this.service.publish({
      organizationId: meta.organizationId as string,
      workflowId,
      definition: input.definition,
      userId: user.userId,
      draftVersionId: input.draftVersionId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @HttpCode(201)
  @Post("draft")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({
    summary: "Save an editable workflow draft",
    description:
      "Creates or updates a single DRAFT version (v0) without publishing. Provide workflowId to update an existing workflow, or projectId to create a new workflow definition from the draft.",
  })
  async saveDraft(
    @Body(new ZodValidationPipe(SaveDraftSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as SaveDraftInput;
    const meta = req as unknown as Record<string, unknown>;
    const organizationId = meta.organizationId as string;

    const existing = input.workflowId
      ? await this.service.get(input.workflowId, organizationId)
      : undefined;
    if (existing && input.projectId && existing.project_id !== input.projectId) {
      throw new BadRequestException("projectId does not match the workflow");
    }
    if (!existing && !input.projectId) {
      throw new BadRequestException("projectId is required when creating a new workflow");
    }

    return this.service.saveDraft({
      organizationId,
      projectId: (existing?.project_id ?? input.projectId) as string,
      workflowId: input.workflowId,
      definition: input.definition,
      userId: user.userId,
    });
  }

  @HttpCode(204)
  @Delete(":workflowId")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Delete a workflow definition" })
  async remove(@Param("workflowId") workflowId: string, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    await this.service.remove(workflowId, meta.organizationId as string);
    return;
  }
}