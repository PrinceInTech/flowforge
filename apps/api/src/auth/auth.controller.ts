import { Body, Controller, Get, HttpCode, Post, Headers, Req } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { FastifyRequest } from "fastify";
import { Public } from "../common/decorators";
import { CurrentUser } from "../common/user.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AuthService } from "./auth.service";
import { RedisService } from "../redis/redis.service";
import { ApiError } from "../common/errors";
import { SignUpSchema, SignInSchema, RefreshTokenSchema } from "@flowforge/shared";

@ApiTags("auth")
@Controller("api/auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @Post("signup")
  @ApiOperation({ summary: "Create an account and an organization" })
  async signup(
    @Body(new ZodValidationPipe(SignUpSchema)) body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const { allowed } = await this.redis.rateLimit(
      `flowforge:rl:signup:${req.ip}`,
      parseInt(process.env.RATE_LIMIT_MAX_SIGNUP ?? "5", 10),
      parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10),
    );
    if (!allowed)
      throw ApiError.tooManyRequests("Too many sign-up attempts from this address");

    const input = body as { email: string; password: string; name?: string };
    return this.auth.signup(input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Public()
  @HttpCode(200)
  @Post("signin")
  @ApiOperation({ summary: "Sign in" })
  async signin(
    @Body(new ZodValidationPipe(SignInSchema)) body: unknown,
    @Req() req: FastifyRequest,
  ) {
    const input = body as { email: string; password: string };
    const { allowed } = await this.redis.rateLimit(
      `flowforge:rl:login:${input.email}`,
      parseInt(process.env.RATE_LIMIT_MAX_LOGIN ?? "10", 10),
      parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60", 10),
    );
    if (!allowed) throw ApiError.tooManyRequests("Too many sign-in attempts");
    return this.auth.signin(input, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Public()
  @HttpCode(200)
  @Post("refresh")
  @ApiOperation({ summary: "Exchange a refresh token for a new token pair" })
  async refresh(
    @Body(new ZodValidationPipe(RefreshTokenSchema)) body: { refreshToken: string },
    @Req() req: FastifyRequest,
  ) {
    return this.auth.refresh(body.refreshToken, {
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });
  }

  @Get("session")
  @ApiOperation({ summary: "Restore the current session (user + organizations)" })
  async session(@CurrentUser() user: { userId: string }) {
    return this.auth.getSession(user.userId);
  }

  @HttpCode(204)
  @Post("signout")
  @ApiOperation({ summary: "Revoke the current session" })
  async signout(@Req() req: FastifyRequest, @Headers("authorization") authz?: string) {
    const token = authz?.replace("Bearer ", "");
    // Best effort: decode the sessionId without blocking sign-out.
    let userId = "";
    let sessionId = "";
    try {
      const decoded = JSON.parse(
        Buffer.from(token!.split(".")[1], "base64url").toString(),
      );
      userId = decoded.sub ?? "";
      sessionId = decoded.sessionId ?? "";
    } catch {
      // If we can't decode, the token is already invalid.
    }
    if (sessionId) {
      await this.auth.signout(userId, sessionId, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
    }
    return;
  }
}
