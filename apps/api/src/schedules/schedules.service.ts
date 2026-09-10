import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/database.service";
import { ApiError } from "../common/errors";
import { AuditService } from "../audit/audit.service";
import * as cronParser from "cron-parser";

@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(organizationId: string, projectId?: string) {
    const params: unknown[] = [organizationId];
    let where = "s.organization_id = $1";
    if (projectId) {
      params.push(projectId);
      where += " AND s.project_id = $2";
    }
    const { rows } = await this.db.query(
      `SELECT s.id, s.organization_id, s.project_id, s.workflow_definition_id,
              s.workflow_version_id, s.name, s.cron, s.timezone, s.enabled,
              s.payload, s.next_run_at, s.last_run_at, s.created_at, s.updated_at,
              wd.name AS workflow_name, wv.version AS workflow_version
       FROM workflow_schedules s
       JOIN workflow_definitions wd ON wd.id = s.workflow_definition_id
       JOIN workflow_versions wv ON wv.id = s.workflow_version_id
       WHERE ${where}
       ORDER BY s.created_at DESC`,
      params,
    );
    return rows;
  }

  async create(input: {
    organizationId: string;
    projectId: string;
    workflowId: string;
    name: string;
    cron: string;
    timezone: string;
    enabled: boolean;
    payload: unknown;
    userId: string;
    ip?: string;
    userAgent?: string;
  }) {
    this.assertCron(input.cron, input.timezone);

    const { rows: vers } = await this.db.query(
      `SELECT v.id FROM workflow_versions v
       JOIN workflow_definitions wd ON wd.id = v.workflow_definition_id
       WHERE wd.id = $1 AND wd.organization_id = $2 AND v.status = 'PUBLISHED'
       ORDER BY v.version DESC LIMIT 1`,
      [input.workflowId, input.organizationId],
    );
    if (vers.length === 0) throw ApiError.conflict("Workflow has no published version");

    const versionId = vers[0].id;
    const nextRunAt = this.nextRun(input.cron, input.timezone);

    const { rows } = await this.db.query(
      `INSERT INTO workflow_schedules
         (organization_id, project_id, workflow_definition_id, workflow_version_id,
          name, cron, timezone, enabled, payload, next_run_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        input.organizationId,
        input.projectId,
        input.workflowId,
        versionId,
        input.name,
        input.cron,
        input.timezone,
        input.enabled,
        JSON.stringify(input.payload ?? {}),
        nextRunAt?.toISOString() ?? null,
      ],
    );

    await this.audit.record({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      action: "SCHEDULE_CREATED",
      entityType: "WORKFLOW_SCHEDULE",
      entityId: rows[0].id,
      metadata: { name: input.name, cron: input.cron },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return this.get(rows[0].id, input.organizationId);
  }

  async update(input: {
    scheduleId: string;
    organizationId: string;
    cron?: string;
    timezone?: string;
    name?: string;
    enabled?: boolean;
    payload?: unknown;
    userId: string;
    ip?: string;
    userAgent?: string;
  }) {
    const current = await this.get(input.scheduleId, input.organizationId);
    if (!current) throw ApiError.notFound("Schedule not found");

    const cron = input.cron ?? current.cron;
    const timezone = input.timezone ?? current.timezone;
    this.assertCron(cron, timezone);

    const enabled = input.enabled ?? current.enabled;
    const nextRunAt = this.nextRun(cron, timezone);

    const { rows } = await this.db.query(
      `UPDATE workflow_schedules
       SET name = COALESCE($2, name),
           cron = COALESCE($3, cron),
           timezone = COALESCE($4, timezone),
           enabled = $5,
           payload = COALESCE($6::jsonb, payload),
           next_run_at = CASE WHEN $5 THEN $7 ELSE next_run_at END,
           updated_at = now()
       WHERE id = $1 AND organization_id = $8
       RETURNING id`,
      [
        input.scheduleId,
        input.name ?? null,
        cron,
        timezone,
        enabled,
        input.payload !== undefined ? JSON.stringify(input.payload) : null,
        nextRunAt?.toISOString() ?? null,
        input.organizationId,
      ],
    );
    if (rows.length === 0) throw ApiError.notFound("Schedule not found");

    await this.audit.record({
      organizationId: input.organizationId,
      projectId: current.project_id,
      userId: input.userId,
      action: input.enabled === false ? "SCHEDULE_DISABLED" : "SCHEDULE_UPDATED",
      entityType: "WORKFLOW_SCHEDULE",
      entityId: input.scheduleId,
      metadata: { name: input.name, cron, enabled },
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return this.get(input.scheduleId, input.organizationId);
  }

  async remove(scheduleId: string, organizationId: string) {
    const { rowCount } = await this.db.query(
      `DELETE FROM workflow_schedules WHERE id = $1 AND organization_id = $2`,
      [scheduleId, organizationId],
    );
    if (rowCount === 0) throw ApiError.notFound("Schedule not found");
  }

  async get(scheduleId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT s.*, wd.name AS workflow_name, wv.version AS workflow_version
       FROM workflow_schedules s
       JOIN workflow_definitions wd ON wd.id = s.workflow_definition_id
       JOIN workflow_versions wv ON wv.id = s.workflow_version_id
       WHERE s.id = $1 AND s.organization_id = $2`,
      [scheduleId, organizationId],
    );
    return rows[0] ?? null;
  }

  private assertCron(cron: string, timezone: string) {
    try {
      cronParser.parseExpression(cron, { currentDate: new Date(), tz: timezone });
    } catch {
      throw ApiError.badRequest(`Invalid cron expression or timezone: '${cron}' (${timezone})`);
    }
  }

  private nextRun(cron: string, timezone: string): Date | null {
    try {
      const interval = cronParser.parseExpression(cron, {
        currentDate: new Date(),
        tz: timezone,
      });
      return interval.next().toDate();
    } catch {
      return null;
    }
  }
}