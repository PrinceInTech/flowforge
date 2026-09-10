import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../db/database.service";
import { RedisService } from "../redis/redis.service";
import { Engine } from "@flowforge/engine";
import { RedisQueue } from "@flowforge/engine";
import { ApiError } from "../common/errors";
import { createHash } from "crypto";
import { IDEMPOTENCY_TTL_SECONDS, type RunTrigger } from "@flowforge/shared";

export interface TriggerOptions {
  organizationId: string;
  projectId?: string;
  workflowId: string;
  payload: unknown;
  trigger: RunTrigger;
  idempotencyKey?: string;
  createdByUserEmail?: string | null;
  scope: "WORKFLOW_RUN" | "WEBHOOK_RUN";
}

@Injectable()
export class RunsService {
  private readonly engine: Engine;

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {
    const workerId = `api-${process.pid}`;
    const leaseSeconds = parseInt(process.env.STEP_LEASE_SECONDS ?? "120", 10);
    this.engine = new Engine(this.db.pool, new RedisQueue(this.redis.client), workerId, leaseSeconds);
  }

  /**
   * Creates a run with optional request idempotency. The idempotency claim and
   * the run are created in a single transaction. A repeated request with the
   * same key returns the original run; a different payload against the same
   * key is rejected so clients cannot accidentally overload a safety feature.
   */
  async trigger(
    options: TriggerOptions,
  ): Promise<{ runId: string; status: string; duplicate: boolean }> {
    // The run is always attributed to the workflow's project, resolved
    // server-side so a caller cannot (mis)attribute a project id.
    const projectId = await this.resolveProjectId(options.organizationId, options.workflowId);
    const normalized: TriggerOptions = { ...options, projectId };
    if (normalized.idempotencyKey) {
      return this.triggerWithIdempotency(normalized);
    }
    return this.createRun(normalized);
  }

  private async resolveProjectId(organizationId: string, workflowId: string): Promise<string> {
    const { rows } = await this.db.query<{ project_id: string }>(
      `SELECT project_id FROM workflow_definitions WHERE id = $1 AND organization_id = $2`,
      [workflowId, organizationId],
    );
    if (rows.length === 0) {
      throw ApiError.notFound("Workflow not found in this organization");
    }
    return rows[0].project_id;
  }

  private async createRun(
    options: TriggerOptions,
  ): Promise<{ runId: string; status: string; duplicate: boolean }> {
    const result = await this.createRunViaEngine(options);
    return { ...result, duplicate: false };
  }

  private async createRunViaEngine(
    options: TriggerOptions,
  ): Promise<{ runId: string; status: string }> {
    const result = await this.engine.createRun({
      organizationId: options.organizationId,
      projectId: options.projectId ?? "",
      workflowDefinitionId: options.workflowId,
      trigger: options.trigger,
      payload: options.payload ?? {},
      createdByUserEmail: options.createdByUserEmail,
    });
    if (!result.runId) {
      // Project does not match or no published version.
      const exists = await this.db.query(
        `SELECT wv.status FROM workflow_definitions wd
         LEFT JOIN workflow_versions wv ON wv.workflow_definition_id = wd.id AND wv.status = 'PUBLISHED'
         WHERE wd.id = $1`,
        [options.workflowId],
      );
      if (exists.rows.length === 0) {
        throw ApiError.notFound("Workflow not found in this project");
      }
      throw ApiError.conflict("This workflow has no published version");
    }
    return result;
  }

  private async triggerWithIdempotency(
    options: TriggerOptions,
  ): Promise<{ runId: string; status: string; duplicate: boolean }> {
    const requestHash = createHash("sha256")
      .update(JSON.stringify(options.payload ?? {}))
      .digest("hex");
    const expires = new Date(Date.now() + IDEMPOTENCY_TTL_SECONDS * 1000);

    const result = await this.db.transaction(async (client) => {
      const claim = await client.query(
        `INSERT INTO idempotency_keys
           (organization_id, project_id, scope, key, request_hash, request_payload, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (scope, key) DO UPDATE SET
           request_hash = CASE WHEN idempotency_keys.workflow_run_id IS NULL
                               THEN EXCLUDED.request_hash ELSE idempotency_keys.request_hash END,
           request_payload = CASE WHEN idempotency_keys.workflow_run_id IS NULL
                                  THEN EXCLUDED.request_payload ELSE idempotency_keys.request_payload END
         RETURNING id, workflow_run_id, request_hash, request_payload`,
        [
          options.organizationId,
          options.projectId ?? "",
          options.scope,
          options.idempotencyKey!,
          requestHash,
          JSON.stringify(options.payload ?? {}),
          expires.toISOString(),
        ],
      );
      const row = claim.rows[0] as {
        id: string;
        workflow_run_id: string | null;
        request_hash: string;
      };

      if (row.workflow_run_id) {
        if (row.request_hash !== requestHash) {
          throw ApiError.conflict(
            "Idempotency-Key was already used with a different payload",
          );
        }
        return {
          runId: row.workflow_run_id,
          status: "EXISTING",
          duplicate: true,
        };
      }

      const run = await this.createRunViaEngine(options);
      await client.query(
        `UPDATE idempotency_keys SET workflow_run_id = $1 WHERE id = $2`,
        [run.runId, row.id],
      );
      return { runId: run.runId, status: run.status, duplicate: false };
    });

    if (result.status === "EXISTING") {
      const state = await this.getRunStatus(result.runId);
      return { runId: result.runId, status: state, duplicate: true };
    }
    return result;
  }

  async getRunStatus(runId: string): Promise<string> {
    const { rows } = await this.db.query(
      `SELECT status FROM workflow_runs WHERE id = $1`,
      [runId],
    );
    return rows[0]?.status ?? "UNKNOWN";
  }

  async list(options: {
    organizationId: string;
    projectId?: string;
    page: number;
    pageSize: number;
    status?: string;
    workflowId?: string;
    trigger?: string;
  }) {
    const conditions: string[] = ["r.organization_id = $1"];
    const params: unknown[] = [options.organizationId];
    let idx = 2;

    if (options.projectId) {
      conditions.push(`r.project_id = $${idx++}`);
      params.push(options.projectId);
    }
    if (options.status) {
      conditions.push(`r.status = $${idx++}`);
      params.push(options.status);
    }
    if (options.workflowId) {
      conditions.push(`r.workflow_definition_id = $${idx++}`);
      params.push(options.workflowId);
    }
    if (options.trigger) {
      conditions.push(`r.trigger = $${idx++}`);
      params.push(options.trigger);
    }

    const where = conditions.join(" AND ");
    const offset = (options.page - 1) * options.pageSize;
    params.push(options.pageSize, offset);

    const { rows } = await this.db.query(
      `SELECT r.id, r.project_id, r.workflow_definition_id, r.workflow_version_id,
              r.run_number, r.trigger, r.status, r.payload, r.error_message,
              r.started_at, r.completed_at, r.created_by_user_email, r.created_at, r.updated_at,
              wd.name AS workflow_name, wv.version
       FROM workflow_runs r
       JOIN workflow_definitions wd ON wd.id = r.workflow_definition_id
       JOIN workflow_versions wv ON wv.id = r.workflow_version_id
       WHERE ${where}
       ORDER BY r.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );
    const { rows: countRows } = await this.db.query(
      `SELECT count(*)::int AS total FROM workflow_runs r WHERE ${where}`,
      params.slice(0, idx - 1),
    );
    const total = countRows[0]?.total ?? 0;

    return {
      items: rows,
      total,
      page: options.page,
      pageSize: options.pageSize,
      hasMore: options.page * options.pageSize < total,
    };
  }

  async getDetail(runId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT r.id, r.project_id, r.workflow_definition_id, r.workflow_version_id,
              r.run_number, r.trigger, r.status, r.payload, r.error_message,
              r.started_at, r.completed_at, r.created_by_user_email, r.created_at, r.updated_at,
              wd.name AS workflow_name, wv.version, p.name AS project_name
       FROM workflow_runs r
       JOIN workflow_definitions wd ON wd.id = r.workflow_definition_id
       JOIN workflow_versions wv ON wv.id = r.workflow_version_id
       JOIN projects p ON p.id = r.project_id
       WHERE r.id = $1 AND r.organization_id = $2`,
      [runId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("Run not found");
    const run = rows[0];

    const { rows: steps } = await this.db.query<Record<string, unknown>>(
      `SELECT id, step_id, step_name, step_type, step_config, status, attempt,
              max_retries, input, output, logs, error_message,
              started_at, completed_at, lease_expires_at, created_at, updated_at
       FROM step_runs
       WHERE workflow_run_id = $1
       ORDER BY created_at ASC`,
      [runId],
    );

    return { run, steps };
  }

  async retry(runId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT id FROM workflow_runs WHERE id = $1 AND organization_id = $2`,
      [runId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("Run not found");
    const ok = await this.engine.retryRun(runId);
    if (!ok) {
      throw ApiError.badRequest("Only FAILED runs can be retried");
    }
    return { runId, status: "QUEUED" };
  }

  async cancel(runId: string, organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT id FROM workflow_runs WHERE id = $1 AND organization_id = $2`,
      [runId, organizationId],
    );
    if (rows.length === 0) throw ApiError.notFound("Run not found");
    const ok = await this.engine.cancelRun(runId);
    if (!ok) {
      throw ApiError.badRequest("Only PENDING, QUEUED, or RUNNING runs can be cancelled");
    }
    return { runId, status: "CANCELLED" };
  }

  async delete(runId: string, organizationId: string) {
    const { rowCount } = await this.db.query(
      `DELETE FROM workflow_runs WHERE id = $1 AND organization_id = $2`,
      [runId, organizationId],
    );
    if (rowCount === 0) throw ApiError.notFound("Run not found");
  }

  async dashboardStats(organizationId: string) {
    const { rows } = await this.db.query(
      `SELECT
         count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS runs24h,
         count(*) FILTER (WHERE status = 'PENDING')::int AS pending_count,
         count(*) FILTER (WHERE status = 'QUEUED')::int AS queued_count,
         count(*) FILTER (WHERE status = 'RUNNING')::int AS running_count,
         count(*) FILTER (WHERE status = 'FAILED')::int AS failed_count,
         count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed_count,
         avg(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) FILTER (WHERE status = 'COMPLETED')::float AS avg_latency_ms
       FROM workflow_runs
       WHERE organization_id = $1`,
      [organizationId],
    );
    const s = rows[0];
    const completed = Number(s.completed_count) || 0;
    const failed = Number(s.failed_count) || 0;
    const total = completed + failed;
    return {
      runs24h: Number(s.runs24h) || 0,
      pendingCount: Number(s.pending_count) || 0,
      queuedCount: Number(s.queued_count) || 0,
      runningCount: Number(s.running_count) || 0,
      failedCount: failed,
      successRate: total === 0 ? 0 : completed / total,
      avgLatencyMs: s.avg_latency_ms ? Math.round(Number(s.avg_latency_ms)) : null,
    };
  }
}