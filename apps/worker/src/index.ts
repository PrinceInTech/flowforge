import Redis from "ioredis";
import { Engine, RedisQueue, QUEUE_RUN, QUEUE_STEP } from "@flowforge/engine";
import {
  concurrency,
  stepLeaseSeconds,
  workerHeartbeatTtlSeconds,
  heartbeatIntervalMs,
  pool,
  redisUrl,
  workerId,
} from "./config";
import { OutboxRelay } from "./outbox-relay";
import { executeStep, type StepHost } from "./executors";
import {
  log,
  activeJobs,
  jobsCompleted,
  jobsStarted,
  executionLatency,
  leaseRecovered,
} from "./metrics";

// Consumers use blocking BLPOPs; the outbox relay must not share the same
// connection or its RPUSH gets starved behind the blocking reads.
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null, // required for blocking commands
  retryStrategy: (times) => Math.min(times * 200, 5000),
});
const relayRedis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 200, 5000),
});

const engine = new Engine(pool, new RedisQueue(redis), workerId, stepLeaseSeconds);

let stepRobots = 0;
let stopped = false;

/**
 * StepHost backed by the engine: persists structured logs onto step_runs. Log
 * writes fail softly — a failed append must not kill execution.
 */
const hostFor = (stepRunId: string, workflowRunId: string, attempt: number): StepHost => ({
  log: async (level, message) => {
    try {
      await engine.appendStepLog(stepRunId, {
        attempt,
        ts: new Date().toISOString(),
        level,
        message,
      });
    } catch {
      /* best effort */
    }
    log({
      msg: `step_log ${message}`,
      workflowRunId,
      stepRunId,
      level,
    });
  },
});

async function processRunMessage(raw: string): Promise<void> {
  try {
    const payload = JSON.parse(raw) as { workflowRunId?: string };
    if (!payload.workflowRunId) {
      log({ msg: "RUN_READY message missing workflowRunId; skipping", raw });
      return;
    }
    await engine.handleRunReady(payload.workflowRunId);
  } catch (err) {
    loggerError("RUN_READY handling failed", raw, err);
  }
}

async function processStepMessage(raw: string): Promise<void> {
  let payload: { stepRunId?: string };
  try {
    payload = JSON.parse(raw) as { stepRunId?: string };
  } catch {
    log({ msg: "unparseable STEP_READY message; skipping", raw });
    return;
  }
  if (!payload.stepRunId) {
    log({ msg: "STEP_READY message missing stepRunId; skipping" });
    return;
  }

  // Find current status so reconciliation/duplicate deliveries are cheap to ignore.
  const ctx = await engine.claimStep(payload.stepRunId);
  if (!ctx) return; // cancelled, already processed, or run not active

  jobsStarted.inc();
  activeJobs.inc();
  const heartbeat = setInterval(
    () => engine.heartbeat(ctx.stepRunId).catch(() => undefined),
    Math.floor((stepLeaseSeconds * 1000) / 3),
  );

  const started = Date.now();
  let result: { ok: boolean; output?: unknown; errorMessage?: string };
  try {
    result = await executeStep(ctx, hostFor(ctx.stepRunId, ctx.workflowRunId, ctx.attempt));
  } catch (err) {
    result = { ok: false, errorMessage: `Executor crashed: ${(err as Error).message}` };
  } finally {
    clearInterval(heartbeat);
    activeJobs.dec();
  }

  executionLatency.observe((Date.now() - started) / 1000);

  if (result.ok) {
    await engine.recordStepSuccess(ctx.stepRunId, result.output);
    jobsCompleted.inc({ status: "completed" });
    log({
      msg: `step completed: ${ctx.stepName} (${ctx.stepType}) attempt ${ctx.attempt}`,
      workflowRunId: ctx.workflowRunId,
      stepRunId: ctx.stepRunId,
    });
  } else {
    const state = await engine.recordStepFailure(
      ctx.stepRunId,
      result.errorMessage ?? "Step failed",
      ctx.retryPolicy,
    );
    jobsCompleted.inc({ status: state.status === "RETRY_SCHEDULED" ? "retry" : "failed" });
    log({
      msg: `step failed: ${ctx.stepName} (${ctx.stepType}) -> ${state.status}`,
      workflowRunId: ctx.workflowRunId,
      stepRunId: ctx.stepRunId,
      errorMessage: result.errorMessage,
      attempt: ctx.attempt,
    });
  }
}

async function runQueueConsumer() {
  // Dedicated blocking connection: BLPOP monopolizes a socket, so it must not
  // share with the relay's RPUSH or other consumers.
  const runRedis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  try {
    while (!stopped) {
      try {
        const raw = await runRedis.blpop(QUEUE_RUN, 1);
        if (raw) {
          await processRunMessage(raw[1]);
        }
      } catch (err) {
        loggerError("run queue consumer failed", null, err);
        await sleep(500);
      }
    }
  } finally {
    runRedis.disconnect();
  }
}

async function stepQueueConsumer() {
  while (!stopped) {
    // Bound in-flight executions to WORKER_CONCURRENCY.
    if (stepRobots >= concurrency) {
      await sleep(50);
      continue;
    }
    stepRobots += 1;
    void consumeSingleStep().finally(() => {
      stepRobots -= 1;
    });
  }
}

async function consumeSingleStep() {
  // Dedicated blocking connection per robot (see runQueueConsumer).
  const stepRedis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 200, 5000),
  });
  try {
    while (!stopped) {
      try {
        const raw = await stepRedis.blpop(QUEUE_STEP, 1);
        if (raw) {
          await processStepMessage(raw[1]);
        }
      } catch (err) {
        loggerError("step consumer failed", null, err);
        await sleep(500);
      }
    }
  } finally {
    stepRedis.disconnect();
  }
}

function loggerError(msg: string, raw: string | null, err: unknown) {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "error",
      service: "flowforge-worker",
      workerId,
      msg,
      raw: raw ? raw.slice(0, 2000) : undefined,
      error: String((err as Error)?.message ?? err),
    }),
  );
}

async function reconciler() {
  while (!stopped) {
    try {
      const recovered = await engine.recoverExpiredLeases();
      if (recovered > 0) {
        leaseRecovered.inc(recovered);
        log({ msg: `lease reconciliation recovered ${recovered} step(s)` });
      }
    } catch (err) {
      loggerError("reconciler failed", null, err);
    }
    await sleep(parseInt(process.env.RECONCILER_INTERVAL_MS ?? "15000", 10));
  }
}

async function workerHeartbeat() {
  while (!stopped) {
    try {
      await redis.set(
        `flowforge:worker:${workerId}`,
        new Date().toISOString(),
        "EX",
        workerHeartbeatTtlSeconds,
      );
    } catch {
      /* transient */
    }
    await sleep(heartbeatIntervalMs);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startMetricsServer() {
  const { createServer } = await import("http");
  const { registry } = await import("./metrics");
  const server = createServer(async (_req, res) => {
    try {
      const body = await registry.metrics();
      res.writeHead(200, { "content-type": registry.contentType });
      res.end(body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  const port = parseInt(process.env.WORKER_METRICS_PORT ?? "9100", 10);
  server.listen(port, () => {
    log({ msg: `worker metrics listening on ${port}` });
  });
}

async function main() {
  log({
    msg: "FlowForge worker starting",
    workerId,
    concurrency,
    stepLeaseSeconds,
  });

  const relay = new OutboxRelay(pool, relayRedis, parseInt(process.env.OUTBOX_RELAY_INTERVAL_MS ?? "1000", 10));
  relay.start();

  void runQueueConsumer();
  void stepQueueConsumer();
  void reconciler();
  void workerHeartbeat();
  void startMetricsServer();

  const shutdown = async () => {
    stopped = true;
    relay.stop();
    await redis.quit();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  log({ msg: "worker loops started" });
}

void main();