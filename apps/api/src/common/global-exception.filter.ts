import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import { ApiError, errorToResponse } from "./errors";

/**
 * Global filter producing a consistent error shape:
 *   { statusCode, errorCode, message, details?, requestId }
 * Request IDs are always echoed back for correlation with structured logs.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId =
      (request.headers["x-request-id"] as string) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let apiError: ApiError | null = null;

    if (exception instanceof ApiError) {
      status = exception.statusCode;
      apiError = exception;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as
        | string
        | { message?: string | string[]; errorCode?: string; details?: unknown };
      const message =
        typeof body === "string"
          ? body
          : Array.isArray(body.message)
            ? body.message.join("; ")
            : body.message ?? exception.message;
      apiError = new ApiError(
        status,
        (typeof body === "object" && body.errorCode) || exception.name,
        message,
        typeof body === "object" ? body.details : undefined,
      );
    } else if (typeof exception === "object" && exception && "message" in exception) {
      const maybe = exception as { status?: number; message?: string };
      status = maybe.status && maybe.status >= 400 && maybe.status < 600 ? maybe.status : 500;
      apiError = new ApiError(
        status,
        "INTERNAL_ERROR",
        status >= 500 ? "Internal server error" : String(maybe.message ?? "Request failed"),
      );
    } else {
      apiError = new ApiError(500, "INTERNAL_ERROR", "Internal server error");
    }

    response
      .header("x-request-id", requestId)
      .status(status)
      .send(errorToResponse(apiError!, requestId));
  }
}