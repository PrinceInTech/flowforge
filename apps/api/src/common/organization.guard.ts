import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { IS_PUBLIC_KEY } from "../common/decorators";
import { DatabaseService } from "../db/database.service";
import { ApiError } from "../common/errors";

/**
 * Authorizes a request against the `X-Organization-Id` header:
 *  - reads the header;
 *  - loads membership for the authenticated user;
 *  - enforces optional role requirements from the @RequireRole decorator;
 *  - exposes `membership` + `organizationId` on the request for downstream services.
 */
@Injectable()
export class OrganizationGuard implements CanActivate {
  constructor(
    private readonly db: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const user = (req as unknown as { user?: { userId: string } }).user;

    // Also allow API-key scoped routes (they resolve their own tenancy).
    const apiKey = (req as unknown as { apiKey?: unknown }).apiKey;
    if (!("tenantChecked" in (req as unknown as Record<string, unknown>)) && !user && !apiKey) {
      // No auth at all should not reach here; JwtAuthGuard handles 401.
      return false;
    }
    if (apiKey) return true;

    const orgId = req.headers["x-organization-id"] as string | undefined;
    if (!orgId) {
      throw ApiError.badRequest("X-Organization-Id header is required");
    }

    const { rows } = await this.db.query(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [orgId, user!.userId],
    );
    if (rows.length === 0) {
      throw ApiError.forbidden("You are not a member of this organization");
    }

    const role = rows[0].role as string;
    const requiredRoles = this.reflector.getAllAndOverride<readonly string[]>(
      "roles",
      [context.getHandler(), context.getClass()],
    );
    if (requiredRoles && requiredRoles.length > 0 && !requiredRoles.includes(role)) {
      throw ApiError.forbidden(
        `This action requires the ${requiredRoles.join(" or ")} role`,
      );
    }

    const meta = req as unknown as Record<string, unknown>;
    meta.membership = { organizationId: orgId, role };
    meta.organizationId = orgId;
    return true;
  }
}