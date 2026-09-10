import { Pool } from "pg";

export const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://flowforge:flowforge@localhost:5432/flowforge";

export const dbSsl = process.env.DB_SSL === "true";

export const redisUrl =
  process.env.REDIS_URL ?? "redis://localhost:6379";

export const workerId =
  process.env.WORKER_ID ?? `worker-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

export const concurrency = parseInt(process.env.WORKER_CONCURRENCY ?? "8", 10);
export const stepLeaseSeconds = parseInt(process.env.STEP_LEASE_SECONDS ?? "120", 10);
export const outboxRelayIntervalMs = parseInt(
  process.env.OUTBOX_RELAY_INTERVAL_MS ?? "1000",
  10,
);
export const reconcilerIntervalMs = parseInt(
  process.env.RECONCILER_INTERVAL_MS ?? "15000",
  10,
);
export const heartbeatIntervalMs = 10_000;
export const workerHeartbeatTtlSeconds = 30;

export const metricsPort = parseInt(process.env.WORKER_METRICS_PORT ?? "9100", 10);

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: dbSsl,
  max: concurrency + 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});