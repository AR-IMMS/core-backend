import { Test } from '@nestjs/testing';

jest.mock(
  '@platform/config',
  () => ({ PlatformConfigModule: class PlatformConfigModule {} }),
  { virtual: true },
);
jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('@nestjs/terminus', () => ({
  HealthCheck: () => () => undefined,
  HealthCheckService: class HealthCheckService {},
  HealthIndicatorService: class HealthIndicatorService {},
  TerminusModule: { forRoot: () => class TerminusDynamicModule {} },
}));
jest.mock('@nestjs/mongoose', () => ({
  InjectConnection: () => () => undefined,
  MongooseModule: { forRootAsync: () => class MongooseDynamicModule {} },
}));

// Match CoreModule's import order: database is loaded before health.
import { DatabaseModule } from '@platform/database';
import { MongoHealthProbe } from '@platform/health/infrastructure/mongodb/mongo-health.probe';
import { HealthReadinessService } from '@platform/health/application/health-readiness.service';
import { HealthModule } from './health.module';

describe('HealthModule', () => {
  /**
   * Confirms the public database module exposes its Mongo probe so Nest can
   * compile the health readiness provider through the real module chain.
   */
  test('resolves the database health probe when compiling', async () => {
    expect(DatabaseModule).toBeDefined();

    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    })
      .overrideProvider(MongoHealthProbe)
      .useValue({})
      .overrideProvider(HealthReadinessService)
      .useValue({})
      .compile();

    await moduleRef.close();
  });
});
