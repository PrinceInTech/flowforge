import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { FastifyRequest, FastifyReply } from "fastify";
import { Observable, tap } from "rxjs";

const SENSITIVE_PATHS = [
  "/api/auth/signin",
  "/api/auth/signup",
  "/api/auth/refresh",
];

interface LogEntry {
  ts: string;
  level: "info";
  msg: string;
  service: string;
  requestId: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  userId?: string;
  organizationId?: string;
  ip?: string;
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const isHttp = context.getType() === "http";
    if (!isHttp) return next.handle();

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();
    const startedAt = Date.now();
    const requestId = (req.headers["x-request-id"] as string) ?? randomUUID();

    try {
      (req as unknown as { requestId: string }).requestId = requestId;
      res.header("x-request-id", requestId);
    } catch {
      /* reply may already be sent */
    }

    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, startedAt, requestId),
        error: () => this.log(req, res, startedAt, requestId),
      }),
    );
  }

  private log(
    req: FastifyRequest,
    res: FastifyReply,
    startedAt: number,
    requestId: string,
  ) {
    const durationMs = Date.now() - startedAt;
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level: "info",
      msg: "http_request",
      service: "flowforge-api",
      requestId,
      method: req.method,
      url: req.url,
      status: res.statusCode,
      durationMs,
      ip: req.ip,
    };

    const scoped = req as unknown as {
      user?: { userId?: string };
      organizationId?: string;
    };
    if (scoped.user?.userId) entry.userId = String(scoped.user.userId);
    if (scoped.organizationId) entry.organizationId = String(scoped.organizationId);

    // Never log the URL of credential-carrying endpoints or their bodies.
    console.log(
      JSON.stringify({ ...entry, logType: "request", safe: !SENSITIVE_PATHS.some((p) => req.url.includes(p)) }),
    );
  }
}