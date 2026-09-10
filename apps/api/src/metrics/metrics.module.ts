import { Controller, Get, Header } from "@nestjs/common";
import { Injectable, Module, OnModuleInit, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { FastifyReply } from "fastify";
import {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { RedisService } from "../redis/redis.service";
import { DatabaseService } from "../db/database.service";
import { Public } from "../common/decorators";

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new Registry();

  readonly runsStarted = new Counter({
    name: "flowforge_workflow_runs_started_total",
    help: "Workflow runs started (created)",
    labelNames: ["trigger"],
    registers: [this.registry],
  });
  readonly runsCompleted = new Counter({
    name: "flowforge_workflow_runs_completed_total",
    help: "Workflow runs completed",
    registers: [this.registry],
  });
  readonly runsFailed = new Counter({
    name: "flowforge_workflow_runs_failed_total",
    help: "Workflow runs failed",
    registers: [this.registry],
  });
  readonly stepRetries = new Counter({
    name: "flowforge_step_retries_total",
    help: "Total step retries scheduled",
    registers: [this.registry],
  });
  readonly queueBacklog = new Gauge({
    name: "flowforge_queue_backlog",
    help: "Number of queued outbox messages pending relay + queue depth",
    registers: [this.registry],
  });
  readonly activeJobs = new Gauge({
    name: "flowforge_worker_active_jobs",
    help: "Number of step runs currently leased (RUNNING)",
    registers: [this.registry],
  });
  readonly workersUp = new Gauge({
    name: "flowforge_workers_up",
    help: "Number of tracked worker processes reporting heartbeats",
    registers: [this.registry],
  });
  readonly leaseRecovered = new Counter({
    name: "flowforge_lease_recoveries_total",
    help: "Step runs recovered from expired leases",
    registers: [this.registry],
  });
  readonly executionLatency = new Histogram({
    name: "flowforge_step_execution_duration_seconds",
    help: "Step execution latency (excluding lease time)",
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registers: [this.registry],
  });

  constructor(
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry, prefix: "flowforge_" });
  }

  async snapshotQueues() {
    try {
      const [runDepth, stepDepth, outboxPending, activeJobs, workersUp] =
        await Promise.all([
          this.redis.llen("flowforge:run"),
          this.redis.llen("flowforge:step"),
          this.db
            .query(`SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL`)
            .then((r) => Number(r.rows[0].n)),
          this.db
            .query(`SELECT count(*)::int AS n FROM step_runs WHERE status = 'RUNNING'`)
            .then((r) => Number(r.rows[0].n)),
          this.redis
            .keys("flowforge:worker:*")
            .then((r) => r.length)
            .catch(() => 0),
        ]);
      this.queueBacklog.set((runDepth + stepDepth + outboxPending) as number);
      this.activeJobs.set(activeJobs as number);
      this.workersUp.set(workersUp as number);
    } catch (err) {
      console.error("[metrics] queue snapshot failed", err);
    }
  }
}

@Controller("api")
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get("metrics")
  @Header("content-type", "text/plain")
  async prometheus(@Res() reply: FastifyReply) {
    await this.metrics.snapshotQueues();
    return reply.type("text/plain").send(await this.metrics.registry.metrics());
  }

  @Public()
  @Get("ops/metrics")
  async opsMetricsJson() {
    await this.metrics.snapshotQueues();
    // Label-less metrics do not expose their value through .get(); read the
    // internal hashMap (keyed by label-set) and sum the values.
    const metricValue = (m: unknown): number =>
      Object.values(
        ((m as { hashMap?: Record<string, { value: number }> }).hashMap) ?? {},
      ).reduce((acc, v) => acc + v.value, 0);
    return {
      queueBacklog: metricValue(this.metrics.queueBacklog),
      activeJobs: metricValue(this.metrics.activeJobs),
      workersUp: metricValue(this.metrics.workersUp),
      leaseRecoveredTotal: metricValue(this.metrics.leaseRecovered),
      runsStartedTotal: metricValue(this.metrics.runsStarted),
      runsCompletedTotal: metricValue(this.metrics.runsCompleted),
      runsFailedTotal: metricValue(this.metrics.runsFailed),
    };
  }
}

@Module({
  providers: [MetricsService, MetricsController],
  controllers: [MetricsController],
  exports: [MetricsService],
})
export class MetricsModule {}