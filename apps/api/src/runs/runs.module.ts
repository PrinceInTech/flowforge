import { Module } from "@nestjs/common";
import { RunsController } from "./runs.controller";
import { RunsService } from "./runs.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [RunsController],
  providers: [RunsService],
  exports: [RunsService],
})
export class RunsModule {}