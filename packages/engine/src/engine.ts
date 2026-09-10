import { Pool, PoolClient } from "pg";
import type {
  WorkflowDefinitionInput,
  WorkflowRunStatus,
} from "@flowforge/shared";
import { generateId } from "@flowforge/shared";
import { computeRetryDelayMs } from "@flowforge/shared";

export const QUEUE_RUN = "flowforge:run";
export const QUEUE_STEP = "flowforge:step";

export interface QueuePublisher {
  publish(queueName: string, payload: unknown): Promise<void>;
}

export interface StepLog {
  attempt: number;
  ts: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface CreateRunInput {
  organizationId: string;
  projectId: string;
  workflowDefinitionId: string;
  trigger: "MANUAL" | "API_KEY" | "WEBHOOK" | "SCHEDULE";
  payload: unknown;
  createdByUserEmail?: string | null;
}

export interface RunStepRow {
  id: string;
  step_id: string;
  step_name: string;
  step_type: string;
  step_config: unknown;
  status: string;
  attempt: number;
  max_retries: number;
  output?: unknown;
}

interface RunRow {
  id: string;
  status: WorkflowRunStatus;
  workflow_definition_id: string;
  workflow_version_id: string;
  payload?: unknown;
}

/**
 * Fetches the raw step rows for a run. If `onlyIncomplete` is truthy, returns
 * only steps not yet COMPLETED (used when deciding what to wake after a step).
 */
async function loadStepRows(
  client: Pool | PoolClient,
  workflowRunId: string,
): Promise<RunStepRow[]> {
  const res = await client.query(
    `SELECT id, step_id, step_name, step_type, step_config, status, attempt, max_retries, output
     FROM step_runs WHERE workflow_run_id = $1`,
    [workflowRunId],
  );
  return res.rows as RunStepRow[];
}

async function loadWorkflowVersionSteps(
  client: Pool | PoolClient,
  workflowVersionId: string,
): Promise<{ id: string; name: string; type: string; config: unknown; dependsOn: string[]; timeoutMs: number; retryPolicy: unknown }[]> {
  const res = await client.query(
    `SELECT definition FROM workflow_versions WHERE id = $1`,
    [workflowVersionId],
  );
  const definition = res.rows[0]?.definition as WorkflowDefinitionInput | undefined;
  return definition?.steps ?? [];
}

function stepRunFromDefinition(
  step: {
    id: string;
    name: string;
    type: string;
    config: unknown;
    timeoutMs: number;
    retryPolicy: { maxRetries?: number } | undefined;
  },
): { stepId: string; stepName: string; stepType: string; stepConfig: unknown; maxRetries: number } {
  return {
    stepId: step.id,
    stepName: step.name,
    stepType: step.type,
    stepConfig: step.config,
    maxRetries: step.retryPolicy?.maxRetries ?? 0,
  };
}

/**
 * Computes which steps still in a non-terminal state are ready to run.
 * A step is ready when all of its dependencies are COMPLETED.
 */
function computeReadySteps(
  steps: { step_id: string; dependsOn: string[] }[],
  pending: RunStepRow[],
): RunStepRow[] {
  const completed = new Set(
    pending.filter((s) => s.status === "COMPLETED").map((s) => s.step_id),
  );
  const byStepId = new Map(steps.map((s) => [s.step_id, s.dependsOn]));
  return pending.filter((s) => {
    if (s.status !== "PENDING") return false;
    const deps = byStepId.get(s.step_id) ?? [];
    return deps.every((dep) => completed.has(dep));
  });
}

/**
 * Computes the input a step receives when it becomes READY:
 *  - A root step (no dependencies) inherits the run payload.
 *  - A dependent step receives the outputs of its completed parents keyed by
 *    their step_id, so templates can use `{{ <parentId>.<field> }}` or a flat
 *    parent id with no path.
 * Returns the JSONB-encodable value.
 */
export function computeStepInput(params: {
  stepId: string;
  definitionSteps: { id: string; dependsOn: string[] }[];
  steps: RunStepRow[];
  runPayload: unknown;
}): unknown {
  const deps = params.definitionSteps.find((s) => s.id === params.stepId)?.dependsOn ?? [];
  if (deps.length === 0) return params.runPayload;

  const outputById = new Map(
    params.steps.filter((s) => s.status === "COMPLETED").map((s) => [s.step_id, s.output]),
  );
  const parentOutputs: Record<string, unknown> = {};
  for (const dep of deps) {
    parentOutputs[dep] = outputById.get(dep) ?? null;
  }
  return parentOutputs;
}


/**
 * Engine is the transactional core shared by the API (which creates runs and
 * enqueues RUN_READY) and the worker (which consumes queue events, executes
 * steps, and drives the state machine). Every transition is row-locked so
 * duplicate queue deliveries are harmless.
 */
export class Engine {
  constructor(
    private readonly pool: Pool,
    private readonly queue: QueuePublisher,
    private readonly workerId: string,
    private readonly leaseSeconds: number,
  ) {}

  async createRun(input: CreateRunInput): Promise<{ runId: string; status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Lock the definition row: serializes run_number allocation per workflow.
      const lockRes = await client.query(
        `SELECT id FROM workflow_definitions
         WHERE id = $1 AND organization_id = $2 AND project_id = $3
         FOR UPDATE`,
        [input.workflowDefinitionId, input.organizationId, input.projectId],
      );
      if (lockRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return { runId: "", status: "" };
      }

      const verRes = await client.query(
        `SELECT id, version, definition FROM workflow_versions
         WHERE workflow_definition_id = $1 AND status IN ('PUBLISHED')
         ORDER BY version DESC LIMIT 1`,
        [input.workflowDefinitionId],
      );
      if (verRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return { runId: "", status: "" };
      }
      const version = verRes.rows[0] as {
        id: string;
        version: number;
        definition: WorkflowDefinitionInput;
      };

      const numRes = await client.query(
        `SELECT COALESCE(MAX(run_number), 0) + 1 AS next FROM workflow_runs
         WHERE workflow_definition_id = $1`,
        [input.workflowDefinitionId],
      );
      const runNumber = numRes.rows[0].next as number;

      const runId = generateId();
      const createdBy = input.createdByUserEmail ?? null;
      await client.query(
        `INSERT INTO workflow_runs
           (id, organization_id, project_id, workflow_definition_id, workflow_version_id,
            run_number, trigger, status, payload, created_by_user_email)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',$8,$9)`,
        [
          runId,
          input.organizationId,
          input.projectId,
          input.workflowDefinitionId,
          version.id,
          runNumber,
          input.trigger,
          JSON.stringify(input.payload ?? {}),
          createdBy,
        ],
      );

      for (const step of version.definition.steps) {
        const mapped = stepRunFromDefinition(step);
        await client.query(
          `INSERT INTO step_runs
             (id, workflow_run_id, workflow_version_id, step_id, step_name, step_type,
              step_config, status, attempt, max_retries, input)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING',0,$8,$9)`,
          [
            generateId(),
            runId,
            version.id,
            mapped.stepId,
            mapped.stepName,
            mapped.stepType,
            JSON.stringify(mapped.stepConfig),
            mapped.maxRetries,
            JSON.stringify(input.payload ?? {}),
          ],
        );
      }

      await client.query(
        `INSERT INTO outbox_events (event_type, entity_type, entity_id, payload)
         VALUES ('RUN_READY','WORKFLOW_RUN',$1,$2)`,
        [runId, JSON.stringify({ workflowRunId: runId })],
      );

      await client.query("COMMIT");
      return { runId, status: "PENDING" };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consume a RUN_READY event. Idempotent: only PENDING runs transition to
   * QUEUED, and root steps are made READY with STEP_READY outbox events written
   * in the same transaction.
   */
  async handleRunReady(workflowRunId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const runRes = await client.query(
        `SELECT id, status, workflow_definition_id, workflow_version_id, payload FROM workflow_runs
         WHERE id = $1 FOR UPDATE`,
        [workflowRunId],
      );
      if (runRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return;
      }
      const run = runRes.rows[0] as RunRow;
      if (run.status !== "PENDING") {
        await client.query("ROLLBACK");
        return;
      }

      await client.query(`UPDATE workflow_runs SET status = 'QUEUED' WHERE id = $1`, [
        workflowRunId,
      ]);

      const steps = await loadStepRows(client, workflowRunId);
      const definitionSteps = await loadWorkflowVersionSteps(client, run.workflow_version_id);
      const ready = computeReadySteps(
        definitionSteps.map((s) => ({ step_id: s.id, dependsOn: s.dependsOn })),
        steps,
      );

      for (const step of ready) {
        const input = computeStepInput({
          stepId: step.step_id,
          definitionSteps,
          steps,
          runPayload: run.payload,
        });
        await client.query(
          `UPDATE step_runs SET status = 'READY', input = $2 WHERE id = $1`,
          [step.id, JSON.stringify(input)],
        );
        await client.query(
          `INSERT INTO outbox_events (event_type, entity_type, entity_id, payload)
           VALUES ('STEP_READY','STEP_RUN',$1,$2)`,
          [step.id, JSON.stringify({ stepRunId: step.id, workflowRunId })],
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Consume a STEP_READY event: marks the step RUNNING and acquires a lease,
   * returning the full execution context. Repeated deliveries are safe because
   * only READY steps can transition to RUNNING (the lease would be refreshed by
   * the owner worker). Returns null when the step is no longer runnable.
   */
  async claimStep(
    stepRunId: string,
  ): Promise<{
    stepRunId: string;
    workflowRunId: string;
    stepId: string;
    stepName: string;
    stepType: string;
    stepConfig: unknown;
    input: unknown;
    attempt: number;
    timeoutMs: number;
    maxRetries: number;
    retryPolicy?: { backoffMs?: number; maxBackoffMs?: number };
  } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const stepRes = await client.query(
        `SELECT s.id, s.workflow_run_id, s.step_id, s.step_name, s.step_type, s.step_config,
                s.status, s.attempt, s.max_retries, s.input,
                r.status AS run_status, r.workflow_version_id
         FROM step_runs s
         JOIN workflow_runs r ON r.id = s.workflow_run_id
         WHERE s.id = $1 FOR UPDATE OF s`,
        [stepRunId],
      );
      if (stepRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return null;
      }
      const row = stepRes.rows[0] as {
        step_run_id: string;
        workflow_run_id: string;
        step_id: string;
        step_name: string;
        step_type: string;
        step_config: unknown;
        status: string;
        attempt: number;
        max_retries: number;
        input: unknown;
        run_status: string;
        workflow_version_id: string;
      };

      if (row.status !== "READY" || !["QUEUED", "RUNNING"].includes(row.run_status)) {
        await client.query("ROLLBACK");
        return null;
      }

      const attempt = row.attempt + 1;
      const leaseExpires = Date.now() + this.leaseSeconds * 1000;
      await client.query(
        `UPDATE step_runs SET status = 'RUNNING', attempt = $2,
                started_at = COALESCE(started_at, now()),
                lease_expires_at = to_timestamp($3 / 1000.0)
         WHERE id = $1`,
        [stepRunId, attempt, leaseExpires],
      );
      await client.query(
        `UPDATE workflow_runs SET status = 'RUNNING', started_at = COALESCE(started_at, now())
         WHERE id = $1`,
        [row.workflow_run_id],
      );
      await client.query(
        `INSERT INTO worker_leases (worker_id, lease_type, target_id, expires_at, metadata)
         VALUES ($1, 'STEP_RUN', $2, to_timestamp($3 / 1000.0), $4)
         ON CONFLICT (lease_type, target_id) DO UPDATE
           SET worker_id = EXCLUDED.worker_id, expires_at = EXCLUDED.expires_at`,
        [this.workerId, stepRunId, leaseExpires, JSON.stringify({ workflowRunId: row.workflow_run_id })],
      );

      const versionSteps = await loadWorkflowVersionSteps(client, row.workflow_version_id);
      const stepDef = versionSteps.find((s) => s.id === row.step_id);
      const timeoutMs = stepDef?.timeoutMs ?? 60_000;
      const retryPolicy =
        (stepDef?.retryPolicy as
          | { backoffMs?: number; maxBackoffMs?: number }
          | undefined) ?? undefined;

      await client.query("COMMIT");

      return {
        stepRunId,
        workflowRunId: row.workflow_run_id,
        stepId: row.step_id,
        stepName: row.step_name,
        stepType: row.step_type,
        stepConfig: row.step_config,
        input: row.input ?? null,
        attempt,
        timeoutMs,
        maxRetries: row.max_retries,
        retryPolicy,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async heartbeat(stepRunId: string): Promise<void> {
    const leaseExpires = Date.now() + this.leaseSeconds * 1000;
    await this.pool.query(
      `UPDATE step_runs SET lease_expires_at = to_timestamp($2 / 1000.0)
       WHERE id = $1 AND status = 'RUNNING'`,
      [stepRunId, leaseExpires],
    );
    await this.pool.query(
      `UPDATE worker_leases SET expires_at = to_timestamp($2 / 1000.0)
       WHERE target_id = $1 AND lease_type = 'STEP_RUN'`,
      [stepRunId, leaseExpires],
    );
  }

  async appendStepLog(stepRunId: string, log: StepLog): Promise<void> {
    await this.pool.query(
      `UPDATE step_runs SET logs = logs || $2::jsonb WHERE id = $1`,
      [stepRunId, JSON.stringify([log])],
    );
  }

  /**
   * Records a successful step execution, wakes dependent steps, and completes
   * the run when no steps remain. Writes STEP_READY outbox events in the same
   * transaction so wake-ups cannot be lost.
   */
  async recordStepSuccess(stepRunId: string, output: unknown): Promise<{ runCompleted: boolean }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const stepRes = await client.query(
        `SELECT s.id, s.workflow_run_id, s.status, s.workflow_version_id, s.step_id
         FROM step_runs s WHERE s.id = $1 FOR UPDATE`,
        [stepRunId],
      );
      if (stepRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return { runCompleted: false };
      }
      const step = stepRes.rows[0] as {
        id: string;
        workflow_run_id: string;
        workflow_version_id: string;
        step_id: string;
        status: string;
      };

      if (step.status === "COMPLETED") {
        await client.query("ROLLBACK");
        return { runCompleted: false };
      }

      await client.query(
        `UPDATE step_runs SET status = 'COMPLETED', output = $2, completed_at = now(),
                lease_expires_at = NULL, error_message = NULL
         WHERE id = $1`,
        [stepRunId, JSON.stringify(output ?? null)],
      );
      await client.query(`DELETE FROM worker_leases WHERE target_id = $1 AND lease_type = 'STEP_RUN'`, [stepRunId]);

      const runRes = await client.query(
        `SELECT id, status, payload FROM workflow_runs WHERE id = $1 FOR UPDATE`,
        [step.workflow_run_id],
      );
      const run = runRes.rows[0] as RunRow;

      const steps = await loadStepRows(client, step.workflow_run_id);
      const definitionSteps = await loadWorkflowVersionSteps(client, step.workflow_version_id);
      const ready = computeReadySteps(
        definitionSteps.map((s) => ({ step_id: s.id, dependsOn: s.dependsOn })),
        steps,
      );

      const remaining =
        steps.filter((s) => s.status !== "COMPLETED").length;

      if (ready.length > 0) {
        await client.query(`UPDATE workflow_runs SET status = 'RUNNING' WHERE id = $1`, [step.workflow_run_id]);
        for (const next of ready) {
          const input = computeStepInput({
            stepId: next.step_id,
            definitionSteps,
            steps,
            runPayload: run.payload,
          });
          await client.query(
            `UPDATE step_runs SET status = 'READY', input = $2 WHERE id = $1`,
            [next.id, JSON.stringify(input)],
          );
          await client.query(
            `INSERT INTO outbox_events (event_type, entity_type, entity_id, payload)
             VALUES ('STEP_READY','STEP_RUN',$1,$2)`,
            [next.id, JSON.stringify({ stepRunId: next.id, workflowRunId: step.workflow_run_id })],
          );
        }
      } else if (remaining <= 0) {
        await client.query(
          `UPDATE workflow_runs SET status = 'COMPLETED', completed_at = now() WHERE id = $1`,
          [step.workflow_run_id],
        );
      }

      await client.query("COMMIT");
      return { runCompleted: remaining <= 0 };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Records a failed step execution. If attempts remain, the step returns to
   * READY with an outbox event scheduled for `now + backoff`. If retries are
   * exhausted, the step becomes DEAD_LETTER and the run FAILS. A failed run is
   * the only terminal state the dashboard can retry in place.
   */
  async recordStepFailure(
    stepRunId: string,
    errorMessage: string,
    retryPolicy: { backoffMs?: number; maxBackoffMs?: number } | undefined,
  ): Promise<{ status: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const stepRes = await client.query(
        `SELECT s.id, s.workflow_run_id, s.status, s.attempt, s.max_retries,
                s.workflow_version_id
         FROM step_runs s WHERE s.id = $1 FOR UPDATE`,
        [stepRunId],
      );
      if (stepRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return { status: "MISSING" };
      }
      const step = stepRes.rows[0] as {
        id: string;
        workflow_run_id: string;
        status: string;
        attempt: number;
        max_retries: number;
      };
      if (step.status === "COMPLETED" || step.status === "DEAD_LETTER") {
        await client.query("ROLLBACK");
        return { status: step.status };
      }

      await client.query(`DELETE FROM worker_leases WHERE target_id = $1 AND lease_type = 'STEP_RUN'`, [stepRunId]);
      await client.query(
        `UPDATE step_runs SET lease_expires_at = NULL WHERE id = $1`,
        [stepRunId],
      );

      if (step.attempt < step.max_retries) {
        await client.query(
          `UPDATE step_runs SET status = 'READY', error_message = $2 WHERE id = $1`,
          [stepRunId, errorMessage],
        );
        const delayMs = computeRetryDelayMs(
          step.attempt,
          retryPolicy?.backoffMs ?? 1_000,
          retryPolicy?.maxBackoffMs ?? 60_000,
        );
        await client.query(
          `INSERT INTO outbox_events (event_type, entity_type, entity_id, payload, available_at)
           VALUES ('STEP_READY','STEP_RUN',$1,$2, now() + ($3 || ' milliseconds')::interval)`,
          [stepRunId, JSON.stringify({ stepRunId, workflowRunId: step.workflow_run_id }), delayMs],
        );
        await client.query("COMMIT");
        return { status: "RETRY_SCHEDULED" };
      }

      await client.query(
        `UPDATE step_runs SET status = 'DEAD_LETTER', error_message = $2 WHERE id = $1`,
        [stepRunId, errorMessage],
      );
      await client.query(
        `UPDATE workflow_runs SET status = 'FAILED', error_message = $2, completed_at = now()
         WHERE id = $1 AND status <> 'CANCELLED'`,
        [step.workflow_run_id, errorMessage],
      );
      await client.query("COMMIT");
      return { status: "DEAD_LETTER" };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Manual retry of a FAILED (or run-level DEAD_LETTER) run: plays back to QUEUED,
   * resets non-completed steps to READY, and emits STEP_READY events.
   */
  async retryRun(workflowRunId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const runRes = await client.query(
        `SELECT id, status FROM workflow_runs WHERE id = $1 FOR UPDATE`,
        [workflowRunId],
      );
      if (runRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      const run = runRes.rows[0] as RunRow;
      if (!["FAILED", "DEAD_LETTER"].includes(run.status)) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `UPDATE workflow_runs SET status = 'QUEUED', error_message = NULL, completed_at = NULL
         WHERE id = $1`,
        [workflowRunId],
      );

      const steps = await loadStepRows(client, workflowRunId);
      const resetSteps = steps.filter((s) => s.status !== "COMPLETED");
      for (const step of resetSteps) {
        await client.query(
          `UPDATE step_runs SET status = 'READY', attempt = 0, error_message = NULL,
                  completed_at = NULL, started_at = NULL
           WHERE id = $1`,
          [step.id],
        );
        await client.query(`DELETE FROM worker_leases WHERE target_id = $1 AND lease_type = 'STEP_RUN'`, [step.id]);
        await client.query(
          `INSERT INTO outbox_events (event_type, entity_type, entity_id, payload)
           VALUES ('STEP_READY','STEP_RUN',$1,$2)`,
          [step.id, JSON.stringify({ stepRunId: step.id, workflowRunId })],
        );
      }

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async cancelRun(workflowRunId: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const runRes = await client.query(
        `SELECT id, status FROM workflow_runs WHERE id = $1 FOR UPDATE`,
        [workflowRunId],
      );
      if (runRes.rows.length === 0) {
        await client.query("ROLLBACK");
        return false;
      }
      const run = runRes.rows[0] as RunRow;
      if (!["PENDING", "QUEUED", "RUNNING"].includes(run.status)) {
        await client.query("ROLLBACK");
        return false;
      }

      await client.query(
        `UPDATE workflow_runs SET status = 'CANCELLED', completed_at = now() WHERE id = $1`,
        [workflowRunId],
      );
      await client.query(
        `UPDATE step_runs SET status = 'CANCELLED', completed_at = now()
         WHERE workflow_run_id = $1 AND status NOT IN ('COMPLETED','CANCELLED')`,
        [workflowRunId],
      );
      await client.query(
        `DELETE FROM worker_leases
         WHERE lease_type = 'STEP_RUN' AND target_id IN
           (SELECT id FROM step_runs WHERE workflow_run_id = $1)`,
        [workflowRunId],
      );

      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Reconciliation: find RUNNING steps whose leases have expired (crashed
   * workers) and return them to READY with a fresh STEP_READY event so another
   * worker can reclaim them. Steps that have already burned their retries move
   * to DEAD_LETTER and fail the run instead of looping forever.
   */
  async recoverExpiredLeases(): Promise<number> {
    const res = await this.pool.query(
      `SELECT id, workflow_run_id, attempt, max_retries
       FROM step_runs
       WHERE status = 'RUNNING' AND lease_expires_at < now()
       LIMIT 100`,
    );
    const expired = res.rows as { id: string; workflow_run_id: string; attempt: number; max_retries: number }[];
    let recovered = 0;

    for (const step of expired) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const locked = await client.query(
          `SELECT id, status, attempt, max_retries FROM step_runs WHERE id = $1 FOR UPDATE`,
          [step.id],
        );
        const current = locked.rows[0] as { id: string; status: string; attempt: number; max_retries: number };
        if (!current || current.status !== "RUNNING") {
          await client.query("ROLLBACK");
          continue;
        }

        await client.query(`DELETE FROM worker_leases WHERE target_id = $1 AND lease_type = 'STEP_RUN'`, [step.id]);

        if (current.attempt > 0 && current.attempt >= current.max_retries && current.max_retries > 0) {
          // The step has already exhausted its retries through lease crashes.
          await client.query(
            `UPDATE step_runs SET status = 'DEAD_LETTER',
               error_message = COALESCE(error_message, 'Lease expired and retry budget exhausted')
             WHERE id = $1`,
            [step.id],
          );
          await client.query(
            `UPDATE workflow_runs SET status = 'FAILED', completed_at = now(),
               error_message = COALESCE(error_message, 'Step lease expired and retry budget exhausted')
             WHERE id = $1 AND status NOT IN ('FAILED','CANCELLED','COMPLETED')`,
            [step.workflow_run_id],
          );
        } else {
          await client.query(
            `UPDATE step_runs SET status = 'READY', lease_expires_at = NULL WHERE id = $1`,
            [step.id],
          );
          await client.query(
            `INSERT INTO outbox_events (event_type, entity_type, entity_id, payload)
             VALUES ('STEP_READY','STEP_RUN',$1,$2)`,
            [step.id, JSON.stringify({ stepRunId: step.id, workflowRunId: step.workflow_run_id })],
          );
        }
        await client.query("COMMIT");
        recovered += 1;
      } catch (err) {
        await client.query("ROLLBACK");
        console.error("[engine] lease recovery failed for", step.id, err);
      } finally {
        client.release();
      }
    }
    return recovered;
  }
}

export { computeReadySteps };

export interface StepWakeResult {
  stepIds: string[];
  runCompleted: boolean;
  runFailed: boolean;
}