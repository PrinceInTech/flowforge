import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { FastifyRequest } from "fastify";
import { ApiError } from "../common/errors";
import { RedisService } from "../redis/redis.service";

interface JwtPayload {
  sub: string;
  email: string;
  name: string | null;
  sessionId: string;
}

export interface AuthUser {
  userId: string;
  email: string;
  name: string | null;
  sessionId: string;
}

/**
 * Access-token JWT strategy. A revocation check is done against Redis so tokens
 * can be invalidated immediately after password changes or sign-out.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    const secret =
      config.get<string>("JWT_ACCESS_SECRET") ?? "dev-access-secret-change-me";
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
      passReqToCallback: true,
    });
  }

  async validate(req: FastifyRequest, payload: JwtPayload): Promise<AuthUser> {
    const revoked = await this.redis.get(
      `flowforge:session:revoked:${payload.sessionId}`,
    );
    if (revoked) throw ApiError.unauthorized("Session revoked");

    // Snapshot the authenticated user onto the request for downstream guards/interceptors.
    (req as unknown as Record<string, unknown>).user = {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      sessionId: payload.sessionId,
    };
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      sessionId: payload.sessionId,
    };
  }
}