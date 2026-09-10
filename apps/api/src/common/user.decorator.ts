import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { FastifyRequest } from "fastify";

export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string | null;
}

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const user = (request as unknown as { user: AuthenticatedUser }).user;
    if (!user) {
      throw new Error("No authenticated user on request");
    }
    return user;
  },
);

export const CurrentApiKey = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): { keyId: string; projectId: string } | null => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    const apiKey = (request as unknown as { apiKey: { keyId: string; projectId: string } })
      .apiKey ?? null;
    return apiKey;
  },
);