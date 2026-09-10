import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";
import type { ZodSchema } from "zod";

/**
 * Validates a request body against a Zod schema and returns the typed, cleaned
 * value. Nested contract fields are validated inside so the deserializer can
 * snapshot the exact request payload for idempotency hashing.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
        code: issue.code,
      }));
      throw new BadRequestException({
        errorCode: "VALIDATION_ERROR",
        message: "Request validation failed",
        details,
      });
    }
    return result.data;
  }
}