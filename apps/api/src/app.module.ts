import { Module } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { DatabaseModule } from "./db/database.module";
import { RedisModule } from "./redis/redis.service";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { LoggingInterceptor } from "./common/logging.interceptor";
import { OrganizationsModule } from "./organizations/organizations.module";
import { ProjectsModule } from "./projects/projects.module";
import { WorkflowsModule } from "./workflows/workflows.module";
import { RunsModule } from "./runs/runs.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { SchedulesModule } from "./schedules/schedules.module";
import { TriggersModule } from "./triggers/triggers.module";
import { MetricsModule } from "./metrics/metrics.module";
import { AuditModule } from "./audit/audit.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    RedisModule,
    DatabaseModule,
    AuditModule,
    AuthModule,
    OrganizationsModule,
    ProjectsModule,
    WorkflowsModule,
    RunsModule,
    ApiKeysModule,
    SchedulesModule,
    TriggersModule,
    MetricsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}