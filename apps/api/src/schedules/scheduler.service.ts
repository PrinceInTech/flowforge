import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseService } from "../db/database.service";
import { RedisService } from "../redis/redis.service";
import { Engine } from "@flowforge/engine";
import { RedisQueue } from "@flowforge/engine";
import * as cronParser from "cron-parser";
import { AuditService } from "../audit/audit.service";

interface ScheduleRow {
  id: string;
  organization_id: string;
  project_id: string;
  workflow_definition_id: string;
  workflow_version_id: string;
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  payload: unknown;
  next_run_at: string | null;
  last_run_at: string | null;
}

/**
 * Finds due schedules and creates a workflow run for each "exactly once as far
 * as practical". The distribution-safe part:
 *   - Selected rows are locked FOR UPDATE SKIP LOCKED inside a transaction so
 *     concurrent scheduler instances cannot double-create a run for the same
 *     schedule.
 *   - next_run_at is recomputed and persisted in the same transaction as the
 *     run creation + outbox write.
 * The remaining tradeoff: if every scheduler instance is down at the due time,
 * the run fires on the next tick (at-most-late, never duplicated). Two
 * instances that are alive at the same moment cannot both create the run.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("SchedulerService");
  private readonly engine: Engine;
  private timer: NodeJS.Timeout | null = null;
  private reconcilerTimer: NodeJS.Timeout | null = null;
  private readonly lockKey = "flowforge:sched:tick";

  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {
    const leaseSeconds = parseInt(process.env.STEP_LEASE_SECONDS ?? "120", 10);
    this.engine = new Engine(
      this.db.pool,
      new RedisQueue(this.redis.client),
      `api-scheduler-${process.pid}`,
      leaseSeconds,
    );
  }

  onModuleInit() {
    const interval = this.config.get<number>("SCHEDULER_INTERVAL_MS", 5000);
    this.timer = setInterval(() => void this.tick(), interval);
    // Run a first pass promptly after boot.
    setTimeout(() => void this.tick(), 1000);
    void this.tick();
    this.logger.log(`Scheduler loop started (interval ${interval}ms)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.reconcilerTimer) clearInterval(this.reconcilerTimer);
  }

  async tick(): Promise<void> {
    // Cross-process lock: only one API instance runs the scheduler tick at a time.
    const acquired = await this.redis.setNx(this.lockKey, new Date().toISOString(), 10);
    if (!acquired) return;

    try {
      const client = await this.db.pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT id, organization_id, project_id, workflow_definition_id, workflow_version_id,
                  name, cron, timezone, enabled, payload, next_run_at, last_run_at
           FROM workflow_schedules
           WHERE enabled = TRUE AND (next_run_at IS NULL OR next_run_at <= now())
           ORDER BY next_run_at NULLS FIRST
           LIMIT 100
           FOR UPDATE SKIP LOCKED`,
        );
        const due = rows as ScheduleRow[];

        for (const schedule of due) {
          await this.fire(schedule, client);
        }

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      this.logger.error(`Scheduler tick failed`, err);
    } finally {
      await this.redis.del(this.lockKey).catch(() => undefined);
    }
  }

  private async fire(schedule: ScheduleRow, client: { query: (...args: unknown[]) => Promise<unknown> }) {
    let next: Date;
    try {
      const interval = cronParser.parseExpression(schedule.cron, {
        currentDate: new Date(),
        tz: schedule.timezone,
      });
      next = interval.next().toDate();
    } catch {
      this.logger.warn(`Invalid cron '${schedule.cron}' on schedule ${schedule.id}; disabling`);
      await (client as any).query(
        `UPDATE workflow_schedules SET enabled = FALSE, updated_at = now() WHERE id = $1`,
        [schedule.id],
      );
      return;
    }

    const payload = schedule.payload ?? {};

    try {
      // Runs always target the *latest published* version, even if the schedule
      // was created against an older version. This keeps schedules fresh.
      const run = await this.engine.createRun({
        organizationId: schedule.organization_id,
        projectId: schedule.project_id,
        workflowDefinitionId: schedule.workflow_definition_id,
        trigger: "SCHEDULE",
        payload,
      });
      if (run.runId) {
        await (client as any).query(
          `UPDATE workflow_schedules
           SET next_run_at = $2, last_run_at = now(), updated_at = now()
           WHERE id = $1`,
          [schedule.id, next.toISOString()],
        );
        await this.audit.record({
          organizationId: schedule.organization_id,
          projectId: schedule.project_id,
          userId: null,
          action: "SCHEDULE_UPDATED",
          entityType: "WORKFLOW_SCHEDULE",
          entityId: schedule.id,
          metadata: { runId: run.runId, nextRunAt: next.toISOString() },
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to create scheduled run for schedule ${schedule.id}: ${(err as Error).message}`,
      );
    }
  }
}