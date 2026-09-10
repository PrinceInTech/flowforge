import { Module } from "@nestjs/common";
import { TriggersController } from "./triggers.controller";
import { RunsModule } from "../runs/runs.module";
import { AuditModule } from "../audit/audit.module";
import { ApiKeysModule } from "../api-keys/api-keys.module";

@Module({
  imports: [RunsModule, AuditModule, ApiKeysModule],
  controllers: [TriggersController],
})
export class TriggersModule {}