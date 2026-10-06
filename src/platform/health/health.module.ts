import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { DatabaseModule } from '@platform/database';
import { MongoHealthProbe } from '@platform/health/infrastructure/mongodb/mongo-health.probe';
import { HealthReadinessService } from '@platform/health/application/health-readiness.service';
import { INFRASTRUCTURE_HEALTH_PROBES } from '@platform/health/domain/health.constants';
import type { InfrastructureHealthProbe } from '@platform/health/domain/ports/infrastructure-health-probe';
import { HealthController } from '@platform/health/presentation/health.controller';

/**
 * Composes health endpoints and the probes for required infrastructure.
 */
@Module({
  imports: [
    DatabaseModule,
    TerminusModule.forRoot({
      gracefulShutdownTimeoutMs: 10_000,
    }),
  ],
  controllers: [HealthController],
  providers: [
    HealthReadinessService,
    {
      provide: INFRASTRUCTURE_HEALTH_PROBES,
      useFactory: (
        mongoProbe: MongoHealthProbe,
      ): readonly InfrastructureHealthProbe[] => [mongoProbe],
      inject: [MongoHealthProbe],
    },
  ],
})
export class HealthModule {}
