import type Redis from "ioredis";
import type { QueuePublisher } from "./engine";

export class RedisQueue implements QueuePublisher {
  constructor(private readonly redis: Redis) {}

  async publish(queueName: string, payload: unknown): Promise<void> {
    await this.redis.rpush(queueName, JSON.stringify(payload));
  }
}