import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { ApiKeysService } from "./api-keys.service";
import { ApiError } from "../common/errors";

/**
 * Resolves `Authorization: Bearer ff_<token>` into a project scoped API key and
 * stamps the request with the key's organization + project, satisfying tenancy
 * for the OrganizationGuard.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const authz = req.headers["authorization"];
    const raw = authz?.replace(/^Bearer\s+/i, "");
    if (!raw) throw ApiError.unauthorized("Missing API key");

    const key = await this.apiKeys.resolve(raw);
    if (!key) throw ApiError.unauthorized("Invalid or revoked API key");

    const meta = req as unknown as Record<string, unknown>;
    meta.apiKey = { keyId: key.keyId, projectId: key.projectId };
    meta.organizationId = key.organizationId;
    meta.apiKeyTenant = key;
    return true;
  }
}