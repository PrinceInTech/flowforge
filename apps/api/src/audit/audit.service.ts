import { Injectable, Module } from "@nestjs/common";
import { DatabaseService } from "../db/database.service";

export interface AuditRecordInput {
  organizationId: string | null;
  projectId?: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly db: DatabaseService) {}

  async record(input: AuditRecordInput) {
    try {
      await this.db.query(
        `INSERT INTO audit_logs
          (organization_id, project_id, user_id, action, entity_type, entity_id, metadata, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          input.organizationId,
          input.projectId ?? null,
          input.userId,
          input.action,
          input.entityType,
          input.entityId,
          JSON.stringify(input.metadata ?? {}),
          input.ip ?? null,
          input.userAgent ?? null,
        ],
      );
    } catch (err) {
      // Audit logging must never break the primary operation.
      console.error("[audit] failed to record event", err);
    }
  }
}

@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}