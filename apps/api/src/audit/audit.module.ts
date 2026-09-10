import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";

/**
 * AuditService is injected by many modules; DatabaseService itself is a
 * @Global provider so no imports are needed here.
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}