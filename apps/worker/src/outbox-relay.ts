import Redis from "ioredis";
import type { Pool } from "pg";
import { log, relayedEvents } from "./metrics";

export const QUEUE_BY_EVENT: Record<string, string> = {
  RUN_READY: "flowforge:run",
  STEP_READY: "flowforge:step",
};

/**
 * Polls the outbox table and publishes unpublished events to the Redis-backed
 * queues. The claim (`published_at IS NULL` conditional update) makes the relay
 * safe for multiple relay instances: if a worker crashes between pushing to
 * Redis and marking published, the next poll re-publishes the event. Consumers
 * are idempotent against that duplicate delivery.
 */
export class OutboxRelay {
  private stopped = false;

  constructor(
    private readonly pool: Pool,
    private readonly redis: Redis,
    private readonly intervalMs: number,
  ) {}

  start() {
    void this.loop();
    log({ msg: "outbox relay started", intervalMs: this.intervalMs });
  }

  stop() {
    this.stopped = true;
  }

  private async loop() {
    while (!this.stopped) {
      try {
        await this.tick();
      } catch (err) {
        console.error("[relay] tick failed", err);
      }
      await sleep(this.intervalMs);
    }
  }

  async tick(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT id, event_type, payload FROM outbox_events
       WHERE published_at IS NULL AND available_at <= now()
       ORDER BY id ASC
       LIMIT 200`,
    );
    let published = 0;
    for (const row of rows as { id: string; event_type: string; payload: unknown }[]) {
      const queue = QUEUE_BY_EVENT[row.event_type];
      if (!queue) continue;

      // Deliver to Redis first, then mark published. If we crash between the
      // RPUSH and the UPDATE, the consumer sees the message twice — but
      // consumers are idempotent (only READY steps transition to RUNNING), so
      // at-least-once is guaranteed and no event is ever lost. Claiming before
      // delivery instead would risk a permanent loss window.
      const message =
        typeof row.payload === "string" ? row.payload : JSON.stringify(row.payload);
      await this.redis.rpush(queue, message);

      const claimed = await this.pool.query(
        `UPDATE outbox_events SET published_at = now()
         WHERE id = $1 AND published_at IS NULL
         RETURNING id`,
        [row.id],
      );
      if (claimed.rows.length === 0) continue; // someone else claimed it

      relayedEvents.inc();
      published += 1;
    }
    if (published > 0) {
      log({ msg: `outbox relay published ${published}`, published });
    }
    return published;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}