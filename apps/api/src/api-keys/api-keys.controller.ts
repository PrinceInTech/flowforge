import {
  Body,
  Controller,
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
import { ApiKeysService } from "./api-keys.service";
import { ApiKeyGuard } from "./api-keys.guard";
import { OrganizationGuard } from "../common/organization.guard";
import { RequireRole } from "../common/decorators";
import { CurrentUser } from "../common/user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CreateApiKeySchema } from "@flowforge/shared";

@ApiTags("api-keys")
@Controller("api/api-keys")
@UseGuards(OrganizationGuard)
export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  @Get()
  @ApiOperation({ summary: "List API keys for the organization", description: "Optional ?projectId= filter. Key hashes are never returned." })
  async list(@Query() query: { projectId?: string }, @Req() req: FastifyRequest) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.list(meta.organizationId as string, query.projectId);
  }

  @HttpCode(201)
  @Post()
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({
    summary: "Create an API key",
    description: "The raw key is returned exactly once. It is stored hashed and can be revoked anytime.",
  })
  async create(
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: unknown,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const input = body as { name: string; projectId?: string };
    const meta = req as unknown as Record<string, unknown>;
    if (!input.projectId) throw new TypeError("projectId is required");
    return this.service.create({
      organizationId: meta.organizationId as string,
      projectId: input.projectId,
      name: input.name,
      userId: user.userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @HttpCode(200)
  @Post(":keyId/revoke")
  @RequireRole("OWNER", "DEVELOPER")
  @ApiOperation({ summary: "Revoke an API key" })
  async revoke(
    @Param("keyId") keyId: string,
    @Req() req: FastifyRequest,
    @CurrentUser() user: { userId: string },
  ) {
    const meta = req as unknown as Record<string, unknown>;
    return this.service.revoke(keyId, meta.organizationId as string, {
      userId: user.userId,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }
}

// The ApiKeyGuard is registered at module level in triggers; exporting it here
// keeps the import graph simple.
export { ApiKeyGuard };