import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/database.service";
import { ApiError } from "../common/errors";
import { AuditService } from "../audit/audit.service";
import {
  generateApiKey,
  hashApiKey,
  generateApiKeyPrefix,
} from "@flowforge/shared";

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, projectId?: string) {
    const params: unknown[] = [organizationId];
    let where = "organization_id = $1";
    if (projectId) {
      params.push(projectId);
      where += " AND project_id = $2";
    }
    const { rows } = await this.db.query(
      `SELECT id, organization_id, project_id, name, prefix, last_used_at, revoked_at, created_at
       FROM api_keys
       WHERE ${where} AND revoked_at IS NULL
       ORDER BY created_at DESC`,
      params,
    );
    return rows;
  }

  async create(input: {
    organizationId: string;
    projectId: string;
    name: string;
    userId: string;
    ip?: string;
    userAgent?: string;
  }) {
    const rawKey = generateApiKey();
    const prefix = generateApiKeyPrefix(rawKey);
    const { rows } = await this.db.query(
      `INSERT INTO api_keys (organization_id, project_id, name, prefix, key_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, organization_id, project_id, name, prefix, created_at`,
      [input.organizationId, input.projectId, input.name, prefix, hashApiKey(rawKey)],
    );
    await this.audit.record({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      action: "API_KEY_CREATED",
      entityType: "API_KEY",
      entityId: rows[0].id,
      metadata: { name: input.name },
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return { ...rows[0], key: rawKey };
  }

  async revoke(keyId: string, organizationId: string, params: { userId: string; ip?: string; userAgent?: string }) {
    const { rows } = await this.db.query(
      `UPDATE api_keys SET revoked_at = now()
       WHERE id = $1 AND organization_id = $2 AND revoked_at IS NULL
       RETURNING id, project_id, name`,
      [keyId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("API key not found or already revoked");
    await this.audit.record({
      organizationId,
      projectId: rows[0].project_id,
      userId: params.userId,
      action: "API_KEY_REVOKED",
      entityType: "API_KEY",
      entityId: keyId,
      metadata: { name: rows[0].name },
      ip: params.ip,
      userAgent: params.userAgent,
    });
    return { id: keyId, revoked: true };
  }

  async touch(keyId: string) {
    await this.db.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [keyId]);
  }

  /**
   * Resolves an Authorization: Bearer ff_... header to a live API key.
   * Returns null when the key is invalid, revoked, or missing.
   */
  async resolve(rawKey: string): Promise<{ keyId: string; projectId: string; organizationId: string } | null> {
    if (!rawKey.startsWith("ff_")) return null;
    const { rows } = await this.db.query(
      `SELECT id, project_id, organization_id FROM api_keys
       WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hashApiKey(rawKey)],
    );
    if (rows.length === 0) return null;
    void this.touch(rows[0].id);
    return {
      keyId: rows[0].id,
      projectId: rows[0].project_id,
      organizationId: rows[0].organization_id,
    };
  }
}