import { Module } from "@nestjs/common";
import { SchedulesController } from "./schedules.controller";
import { SchedulesService } from "./schedules.service";
import { SchedulerService } from "./scheduler.service";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [AuditModule],
  controllers: [SchedulesController],
  providers: [SchedulesService, SchedulerService],
  exports: [SchedulesService],
})
export class SchedulesModule {}