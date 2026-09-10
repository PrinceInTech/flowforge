import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import { workerId } from "./config";

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: "flowforge_" });

export const jobsStarted = new Counter({
  name: "flowforge_worker_jobs_started_total",
  help: "Step executions started by this worker",
  registers: [registry],
});

export const jobsCompleted = new Counter({
  name: "flowforge_worker_jobs_completed_total",
  help: "Step executions completed by this worker",
  labelNames: ["status"],
  registers: [registry],
});

export const stepRetriesScheduled = new Counter({
  name: "flowforge_worker_step_retries_total",
  help: "Retries scheduled by this worker",
  registers: [registry],
});

export const executionLatency = new Histogram({
  name: "flowforge_worker_step_execution_duration_seconds",
  help: "Step execution latency measured at the worker",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
  registers: [registry],
});

export const activeJobs = new Gauge({
  name: "flowforge_worker_active_jobs",
  help: "Step executions currently in-flight in this worker",
  registers: [registry],
});

export const relayedEvents = new Counter({
  name: "flowforge_outbox_relayed_total",
  help: "Outbox events published to the queue",
  registers: [registry],
});

export const leaseRecovered = new Counter({
  name: "flowforge_lease_recoveries_total",
  help: "Expired step leases recovered by this worker's reconciler",
  registers: [registry],
});

export function log(entry: Record<string, unknown>) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      service: "flowforge-worker",
      workerId,
      ...entry,
    }),
  );
}