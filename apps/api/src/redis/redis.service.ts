import {
  Global,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL") ?? "redis://localhost:6379";
    this.client = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 5000),
      lazyConnect: false,
    });
  }

  async onModuleInit() {
    await this.client.ping().catch((err) => {
      console.warn("[redis] initial ping failed, will retry lazily", err?.message);
    });
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }

  async setEx(key: string, ttlSeconds: number, value: string) {
    await this.client.set(key, value, "EX", ttlSeconds);
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async del(key: string) {
    await this.client.del(key);
  }

  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /**
   * Sliding log-ish fixed window rate limit. Returns true when allowed.
   */
  async rateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number }> {
    const current = await this.incr(key);
    if (current === 1) {
      await this.client.expire(key, windowSeconds).catch(() => undefined);
    }
    const remaining = Math.max(0, limit - current);
    return { allowed: current <= limit, remaining };
  }

  async expire(key: string, ttlSeconds: number) {
    await this.client.expire(key, ttlSeconds);
  }

  async rpush(key: string, value: string) {
    await this.client.rpush(key, value);
  }

  async lpop(key: string): Promise<string | null> {
    return this.client.lpop(key);
  }

  async llen(key: string): Promise<number> {
    return this.client.llen(key);
  }

  /**
   * Returns the cast/allocate value. If `key` already has a value, returns it.
   * Used for distributed coordination locks and idempotency keys.
   */
  async setNx(key: string, value: string, ttlSeconds = 0): Promise<boolean> {
    if (ttlSeconds > 0) {
      const result = await this.client.set(key, value, "EX", ttlSeconds, "NX");
      return result === "OK";
    }
    const result = await this.client.set(key, value, "NX");
    return result === "OK";
  }

  async keys(pattern: string): Promise<string[]> {
    return this.client.keys(pattern);
  }

  async publish(channel: string, message: string): Promise<number> {
    return this.client.publish(channel, message);
  }
}

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}