import { Inject, Injectable } from '@nestjs/common';
import { HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';

import {
  HEALTH_PROBE_TIMEOUT_MS,
  INFRASTRUCTURE_HEALTH_PROBES,
} from '@platform/health/domain/health.constants';
import type { InfrastructureHealthProbe } from '@platform/health/domain/ports/infrastructure-health-probe';

/**
 * Runs the required infrastructure probes used by the readiness endpoint.
 */
@Injectable()
export class HealthReadinessService {
  constructor(
    private readonly healthCheckService: HealthCheckService,
    private readonly healthIndicatorService: HealthIndicatorService,
    @Inject(INFRASTRUCTURE_HEALTH_PROBES)
    private readonly probes: readonly InfrastructureHealthProbe[],
  ) {}

  check() {
    const checks = this.probes.map(
      (probe) => () =>
        this.healthIndicatorService
          .check(probe.key)
          .attempt(async ({ signal }) => {
            try {
              await probe.check(signal);
            } catch {
              throw new Error('Infrastructure health probe failed');
            }
          })
          .withTimeout(HEALTH_PROBE_TIMEOUT_MS),
    );

    return this.healthCheckService.check(checks);
  }
}
