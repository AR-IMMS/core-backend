import type { HealthCheckResult } from '@nestjs/terminus';

jest.mock('@nestjs/terminus', () => ({
  HealthCheck: () => () => undefined,
  HealthCheckService: class HealthCheckService {},
  HealthIndicatorService: class HealthIndicatorService {},
}));
jest.mock(
  '@platform/health/domain/health.constants',
  () => ({
    HEALTH_PROBE_TIMEOUT_MS: 1_500,
    INFRASTRUCTURE_HEALTH_PROBES: Symbol('INFRASTRUCTURE_HEALTH_PROBES'),
  }),
  { virtual: true },
);
jest.mock(
  '@platform/health/application/health-readiness.service',
  () => ({
    HealthReadinessService: class HealthReadinessService {},
  }),
  { virtual: true },
);

import { HealthReadinessService } from './application/health-readiness.service';
import { HEALTH_PROBE_TIMEOUT_MS } from './domain/health.constants';
import type { InfrastructureHealthProbe } from './domain/ports/infrastructure-health-probe';
import { MongoHealthProbe } from './infrastructure/mongodb/mongo-health.probe';
import { HealthController } from './presentation/health.controller';

describe('HealthController', () => {
  /**
   * Returns the liveness payload without requiring any infrastructure dependency,
   * so callers can determine whether the application process is running.
   */
  test('returns an ok status from the liveness endpoint', () => {
    const controller = new HealthController({
      check: jest.fn(),
    } as unknown as HealthReadinessService);

    expect(controller.live()).toEqual({ status: 'ok' });
  });

  /**
   * Returns the readiness result produced by the infrastructure readiness service,
   * preserving the result that Terminus exposes to the HTTP client.
   */
  test('returns the readiness result from the readiness service', async () => {
    const readinessResult = {
      status: 'ok',
      info: {},
      error: {},
      details: {},
    } as HealthCheckResult;
    const check = jest.fn().mockResolvedValue(readinessResult);
    const controller = new HealthController({
      check,
    } as unknown as HealthReadinessService);

    await expect(controller.ready()).resolves.toBe(readinessResult);
    expect(check).toHaveBeenCalledTimes(1);
  });
});

describe('HealthReadinessService', () => {
  /**
   * Runs every registered infrastructure probe through Terminus with the shared
   * timeout, passing the cancellation signal supplied by the health framework.
   */
  test('runs every registered probe with the configured timeout', async () => {
    const signal = new AbortController().signal;
    const firstProbe = createProbe('mongodb');
    const secondProbe = createProbe('redis');
    const timeouts: number[] = [];
    const healthIndicatorService = {
      check: jest.fn((key: string) => ({
        attempt: (
          callback: (context: { signal: AbortSignal }) => Promise<void>,
        ) => ({
          withTimeout: async (timeout: number) => {
            timeouts.push(timeout);
            await callback({ signal });
            return { [key]: { status: 'up' } };
          },
        }),
      })),
    };
    const healthCheckService = {
      check: async (checks: Array<() => Promise<unknown>>) => {
        await Promise.all(checks.map((check) => check()));
        return {
          status: 'ok',
          info: {},
          error: {},
          details: {},
        } as HealthCheckResult;
      },
    };
    const service = new HealthReadinessService(
      healthCheckService as never,
      healthIndicatorService as never,
      [firstProbe.probe, secondProbe.probe],
    );

    await expect(service.check()).resolves.toMatchObject({ status: 'ok' });
    expect(firstProbe.check).toHaveBeenCalledWith(signal);
    expect(secondProbe.check).toHaveBeenCalledWith(signal);
    expect(healthIndicatorService.check).toHaveBeenNthCalledWith(1, 'mongodb');
    expect(healthIndicatorService.check).toHaveBeenNthCalledWith(2, 'redis');
    expect(timeouts).toEqual([
      HEALTH_PROBE_TIMEOUT_MS,
      HEALTH_PROBE_TIMEOUT_MS,
    ]);
  });

  /**
   * Replaces an infrastructure-specific probe exception with the stable readiness
   * failure message, preventing internal dependency details from escaping.
   */
  test('normalizes a failed infrastructure probe error', async () => {
    const probe = createProbe('mongodb', new Error('connection refused'));
    const healthIndicatorService = {
      check: jest.fn(() => ({
        attempt: (
          callback: (context: { signal: AbortSignal }) => Promise<void>,
        ) => ({
          withTimeout: () => callback({ signal: new AbortController().signal }),
        }),
      })),
    };
    const healthCheckService = {
      check: ([check]: Array<() => Promise<unknown>>) => check(),
    };
    const service = new HealthReadinessService(
      healthCheckService as never,
      healthIndicatorService as never,
      [probe.probe],
    );

    await expect(service.check()).rejects.toThrow(
      'Infrastructure health probe failed',
    );
  });
});

describe('MongoHealthProbe', () => {
  /**
   * Rejects readiness when Mongoose has no database handle, rather than treating
   * an unconnected MongoDB client as healthy.
   */
  test('rejects when the MongoDB database handle is unavailable', async () => {
    const probe = new MongoHealthProbe({ db: undefined } as never);

    await expect(probe.check(new AbortController().signal)).rejects.toThrow(
      'MongoDB connection is not available',
    );
  });

  /**
   * Sends MongoDB's lightweight ping command with the health-check abort signal,
   * allowing a successful connection to be reported as ready.
   */
  test('pings MongoDB with the provided abort signal', async () => {
    const command = jest.fn().mockResolvedValue({ ok: 1 });
    const probe = new MongoHealthProbe({ db: { command } } as never);
    const signal = new AbortController().signal;

    await expect(probe.check(signal)).resolves.toBeUndefined();
    expect(command).toHaveBeenCalledWith({ ping: 1 }, { signal });
  });
});

function createProbe(
  key: string,
  failure?: Error,
): {
  probe: InfrastructureHealthProbe;
  check: jest.Mock<Promise<void>, [AbortSignal]>;
} {
  const check = jest
    .fn<Promise<void>, [AbortSignal]>()
    .mockImplementation(() => {
      if (failure) {
        return Promise.reject(failure);
      }

      return Promise.resolve();
    });

  return { probe: { key, check }, check };
}
