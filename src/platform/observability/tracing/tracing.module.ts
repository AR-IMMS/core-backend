import { Module } from '@nestjs/common';

import { TracingShutdownService } from './tracing.shutdown.service';

/**
 * Registers OpenTelemetry lifecycle integration for the Core application.
 */
@Module({
  providers: [TracingShutdownService],
})
export class TracingModule {}
