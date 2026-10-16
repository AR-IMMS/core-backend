import { PublicRoute, RawResponse } from '@/platform/http/api';
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, type HealthCheckResult } from '@nestjs/terminus';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthReadinessService } from '@platform/health/application/health-readiness.service';

/**
 * Exposes process liveness and infrastructure readiness endpoints.
 */
@RawResponse()
@Controller('health')
@ApiTags('Health')
export class HealthController {
  constructor(
    private readonly healthReadinessService: HealthReadinessService,
  ) {}

  @Get('live')
  @PublicRoute()
  @ApiOperation({ summary: 'Check process liveness' })
  @ApiOkResponse({ description: 'The process is running.' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @PublicRoute()
  @HealthCheck()
  @ApiOperation({ summary: 'Check required infrastructure readiness' })
  @ApiOkResponse({
    description: 'Application and required dependencies are ready.',
  })
  ready(): Promise<HealthCheckResult> {
    return this.healthReadinessService.check();
  }
}
