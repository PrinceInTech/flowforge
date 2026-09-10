import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { OrgRole } from "@flowforge/shared";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CurrentUser } from "../common/user.decorator";
import { ApiError } from "../common/errors";
import { OrganizationGuard } from "../common/organization.guard";
import { RequireRole } from "../common/decorators";
import { OrganizationsService } from "./organizations.service";
import { AuditService } from "../audit/audit.service";
import {
  CreateOrganizationSchema,
  InviteMemberSchema,
  UpdateMemberRoleSchema,
} from "@flowforge/shared";

@ApiTags("organizations")
@Controller("api/organizations")
export class OrganizationsController {
  constructor(
    private readonly service: OrganizationsService,
    private readonly audit: AuditService,
  ) {}

  @HttpCode(201)
  @Post()
  @ApiOperation({ summary: "Create a new organization (becomes OWNER)" })
  async create(
    @Body(new ZodValidationPipe(CreateOrganizationSchema)) body: unknown,
    @CurrentUser() user: { userId: string },
    @Req() req: FastifyRequest,
  ) {
    const input = body as { name: string };
    const org = await this.service.create(input.name, user.userId);
    await this.audit.record({
      organizationId: org.id,
      userId: user.userId,
      action: "ORG_CREATED",
      entityType: "ORGANIZATION",
      entityId: org.id,
      metadata: { name: org.name },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return org;
  }

  @Get()
  @ApiOperation({ summary: "List organizations the user belongs to" })
  async listMy(@CurrentUser() user: { userId: string }) {
    return this.service.listForUser(user.userId);
  }

  @Get(":orgId")
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: "Get organization detail", description: "Uses X-Organization-Id header scoping; the path id is informational." })
  async detail(@Param("orgId") orgId: string, @Req() req: FastifyRequest) {
    const reqOrgId = (req as unknown as Record<string, unknown>).organizationId as string;
    const org = await this.service.get(reqOrgId);
    if (!org) throw ApiError.notFound("Organization not found");
    const role = (req as unknown as { membership?: { role: string } }).membership?.role;
    return role ? { ...org, role } : org;
  }

  @Get(":orgId/members")
  @UseGuards(OrganizationGuard)
  @ApiOperation({ summary: "List organization members" })
  async members(@Req() req: FastifyRequest) {
    const reqOrgId = (req as unknown as Record<string, unknown>).organizationId as string;
    return this.service.listMembers(reqOrgId);
  }

  @HttpCode(201)
  @Post(":orgId/members")
  @UseGuards(OrganizationGuard)
  @RequireRole("OWNER")
  @ApiOperation({ summary: "Add a member by email (invite)", description: "The invited account must already exist." })
  async addMember(
    @Body(new ZodValidationPipe(InviteMemberSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as { email: string; role: OrgRole };
    const reqOrgId = (req as unknown as Record<string, unknown>).organizationId as string;
    const member = await this.service.addMember(reqOrgId, input.email, input.role);
    if (!member) {
      throw ApiError.notFound("No user with that email exists");
    }
    await this.audit.record({
      organizationId: reqOrgId,
      userId: user.userId,
      action: "ORG_MEMBER_INVITED",
      entityType: "ORGANIZATION_MEMBER",
      entityId: member.id,
      metadata: { email: input.email, role: input.role },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return member;
  }

  @Patch(":orgId/members/:userId")
  @UseGuards(OrganizationGuard)
  @RequireRole("OWNER")
  @ApiOperation({ summary: "Change a member's role" })
  async changeRole(
    @Param("userId") targetUserId: string,
    @Body(new ZodValidationPipe(UpdateMemberRoleSchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as { role: OrgRole };
    const reqOrgId = (req as unknown as Record<string, unknown>).organizationId as string;
    if (targetUserId === user.userId && input.role !== "OWNER") {
      throw ApiError.badRequest("You cannot demote yourself");
    }
    const member = await this.service.updateRole(reqOrgId, targetUserId, input.role);
    if (!member) throw ApiError.notFound("Member not found");
    await this.audit.record({
      organizationId: reqOrgId,
      userId: user.userId,
      action: "ORG_MEMBER_ROLE_CHANGED",
      entityType: "ORGANIZATION_MEMBER",
      entityId: member.id,
      metadata: { role: input.role },
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return member;
  }

  @HttpCode(204)
  @Delete(":orgId/members/:userId")
  @UseGuards(OrganizationGuard)
  @RequireRole("OWNER")
  @ApiOperation({ summary: "Remove a member" })
  async removeMember(
    @Param("userId") targetUserId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const reqOrgId = (req as unknown as Record<string, unknown>).organizationId as string;
    if (targetUserId === user.userId) {
      throw ApiError.badRequest("You cannot remove yourself; transfer ownership first");
    }
    const removed = await this.service.removeMember(reqOrgId, targetUserId);
    if (!removed) throw ApiError.notFound("Member not found");
    await this.audit.record({
      organizationId: reqOrgId,
      userId: user.userId,
      action: "ORG_MEMBER_REMOVED",
      entityType: "USER",
      entityId: targetUserId,
      metadata: {},
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
    return;
  }
}