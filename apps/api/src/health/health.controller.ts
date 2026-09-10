import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";
import { Public } from "../common/decorators";
import { RedisService } from "../redis/redis.service";
import { DatabaseService } from "../db/database.service";

@ApiTags("health")
@Controller("api/health")
export class HealthController {
  constructor(
    private readonly redis: RedisService,
    private readonly db: DatabaseService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: "Liveness probe" })
  liveness() {
    return { status: "ok", service: "flowforge-api", ts: new Date().toISOString() };
  }

  @Public()
  @Get("ready")
  @ApiOperation({ summary: "Readiness probe (checks Postgres and Redis)" })
  async readiness() {
    const checks: Record<string, string> = {};

    try {
      await this.db.query("SELECT 1");
      checks.postgres = "up";
    } catch {
      checks.postgres = "down";
    }

    try {
      await this.redis.client.ping();
      checks.redis = "up";
    } catch {
      checks.redis = "down";
    }

    const ready = checks.postgres === "up" && checks.redis === "up";
    return {
      status: ready ? "ready" : "not_ready",
      checks,
      ts: new Date().toISOString(),
    };
  }
}