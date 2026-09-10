export interface RequestContext {
  requestId: string;
  userId?: string;
  email?: string;
  organizationId?: string;
  projectId?: string;
  workflowRunId?: string;
  stepRunId?: string;
}

export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: string;
  readonly details?: unknown;

  constructor(
    statusCode: number,
    errorCode: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "VALIDATION_ERROR", message, details);
  }

  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message: string) {
    return new ApiError(409, "CONFLICT", message);
  }

  static tooManyRequests(message = "Rate limit exceeded") {
    return new ApiError(429, "RATE_LIMITED", message);
  }
}

export function errorToResponse(err: unknown, requestId: string) {
  if (err instanceof ApiError) {
    return {
      statusCode: err.statusCode,
      errorCode: err.errorCode,
      message: err.message,
      details: err.details,
      requestId,
    };
  }
  return {
    statusCode: 500,
    errorCode: "INTERNAL_ERROR",
    message: "Internal server error",
    requestId,
  };
}