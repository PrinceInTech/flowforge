import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool, PoolClient } from "pg";

export interface Row {
  // Deliberately loose: result rows are treated as untyped records and cast at
  // the call site. `any` (not `unknown`) keeps parameterized read paths ergonomic.
  [column: string]: any;
}

/**
 * Thin wrapper over node-postgres. Every query is parameterized. This layer
 * exposes helpers for the transactional patterns (outbox + row locks) that the
 * orchestration logic depends on.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = new Pool({
      connectionString:
        config.get<string>("DATABASE_URL") ??
        "postgres://flowforge:flowforge@localhost:5432/flowforge",
      ssl: config.get<string>("DB_SSL") === "true",
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  async onModuleInit() {
    const client = await this.pool.connect();
    try {
      client.release();
    } finally {
      await this.pool.query("SELECT 1");
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  query<T extends Row = Row>(text: string, params: unknown[] = []) {
    return this.pool.query<T>(text, params);
  }

  async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Connects a dedicated client: used by long-lived worker loops so heartbeats
   * do not need to be multiplexed through the pool. Caller must release().
   */
  async connect(): Promise<PoolClient> {
    return this.pool.connect();
  }
}