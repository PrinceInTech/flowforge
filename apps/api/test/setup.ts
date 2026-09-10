jest.setTimeout(60_000);
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://flowforge:flowforge@localhost:5432/flowforge";
if (!process.env.REDIS_URL) {
  process.env.REDIS_URL = "redis://localhost:6379";
}