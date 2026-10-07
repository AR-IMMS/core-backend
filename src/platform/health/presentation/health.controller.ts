import { RawResponse } from '@/platform/http/api';
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, type HealthCheckResult } from '@nestjs/terminus';

import { HealthReadinessService } from '@platform/health/application/health-readiness.service';

/**
 * Exposes process liveness and infrastructure readiness endpoints.
 */
@RawResponse()
@Controller('health')
export class HealthController {
  constructor(
    private readonly healthReadinessService: HealthReadinessService,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.healthReadinessService.check();
  }
}
