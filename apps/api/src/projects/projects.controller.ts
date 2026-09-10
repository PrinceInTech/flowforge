import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { ProjectsService } from "./projects.service";
import { OrganizationGuard } from "../common/organization.guard";
import { RequireRole } from "../common/decorators";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CreateProjectSchema } from "@flowforge/shared";
import { AuditService } from "../audit/audit.service";
import { CurrentUser } from "../common/user.decorator";

@ApiTags("projects")
@Controller("api/projects")
@UseGuards(OrganizationGuard)
export class ProjectsController {
  constructor(
    private readonly service: ProjectsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List projects" })
  async list(@Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.list(meta.organizationId as string);
  }

  @HttpCode(201)
  @Post()
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Create a project" })
  async create(
    @Body(new ZodValidationPipe(CreateProjectSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as { name: string; description?: string };
    const meta = req as unknown as Record<string, unknown>;
    const orgId = meta.organizationId as string;
    const project = await this.service.create({
      organizationId: orgId,
      name: input.name,
      description: input.description,
    });
    await this.audit.record({
      organizationId: orgId,
      projectId: project.id,
      userId: user.userId,
      action: "PROJECT_CREATED",
      entityType: "PROJECT",
      entityId: project.id,
      metadata: { name: project.name },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return project;
  }
}