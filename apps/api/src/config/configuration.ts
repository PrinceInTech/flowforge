export default () => ({
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: parseInt(process.env.PORT ?? "3000", 10),
  host: process.env.HOST ?? "0.0.0.0",
  databaseUrl:
    process.env.DATABASE_URL ??
    "postgres://flowforge:flowforge@localhost:5432/flowforge",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL ?? "900", 10),
    refreshTtl: parseInt(process.env.JWT_REFRESH_TTL ?? "604800", 10),
  },
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:5173",
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? "http://localhost:3000",
  publicWebUrl: process.env.PUBLIC_WEB_URL ?? "http://localhost:5173",
  rateLimit: {
    windowSeconds: parseInt(
      process.env.RATE_LIMIT_WINDOW_SECONDS ?? "60",
      10,
    ),
    maxLogin: parseInt(process.env.RATE_LIMIT_MAX_LOGIN ?? "10", 10),
    maxWebhook: parseInt(process.env.RATE_LIMIT_MAX_WEBHOOK ?? "60", 10),
    maxApiKey: parseInt(process.env.RATE_LIMIT_MAX_API_KEY ?? "120", 10),
  },
  worker: {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY ?? "8", 10),
    stepLeaseSeconds: parseInt(process.env.STEP_LEASE_SECONDS ?? "120", 10),
    schedulerIntervalMs: parseInt(
      process.env.SCHEDULER_INTERVAL_MS ?? "5000",
      10,
    ),
    reconcilerIntervalMs: parseInt(
      process.env.RECONCILER_INTERVAL_MS ?? "15000",
      10,
    ),
    outboxRelayIntervalMs: parseInt(
      process.env.OUTBOX_RELAY_INTERVAL_MS ?? "1000",
      10,
    ),
  },
});

export interface AppConfig {
  nodeEnv: string;
  port: number;
  host: string;
  databaseUrl: string;
  redisUrl: string;
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: number;
    refreshTtl: number;
  };
  corsOrigin: string;
  webhookBaseUrl: string;
  publicWebUrl: string;
  rateLimit: {
    windowSeconds: number;
    maxLogin: number;
    maxWebhook: number;
    maxApiKey: number;
  };
  worker: {
    concurrency: number;
    stepLeaseSeconds: number;
    schedulerIntervalMs: number;
    reconcilerIntervalMs: number;
    outboxRelayIntervalMs: number;
  };
}