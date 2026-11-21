/* eslint-disable @typescript-eslint/unbound-method -- Jest inspects the mocked ConditionalModule registration. */
import { MODULE_METADATA } from '@nestjs/common/constants';

jest.mock('@nestjs/config', () => ({
  ConditionalModule: {
    registerWhen: jest.fn(() => ({ module: class ConditionalModule {} })),
  },
}));
jest.mock('@modules/ticket/ticket.module', () => ({
  TicketModule: class TicketModule {},
}));

jest.mock('@/platform/observability/tracing', () => ({
  TracingModule: class TracingModule {},
}));
jest.mock('@modules/audit/application/audit-event.consumer', () => ({
  AuditEventConsumer: class AuditEventConsumer {},
}));
jest.mock('@modules/audit/audit.module', () => ({
  AuditModule: class AuditModule {},
}));
jest.mock('@modules/iam/iam.module', () => ({
  IamModule: class IamModule {},
}));
jest.mock('@platform/config', () => ({
  PlatformConfigModule: class PlatformConfigModule {},
}));
jest.mock('@platform/database', () => ({
  DatabaseModule: class DatabaseModule {},
}));
jest.mock('@platform/events', () => ({
  OutboxRelayService: class OutboxRelayService {},
  PlatformEventsModule: {
    register: () => ({ module: class PlatformEventsDynamicModule {} }),
  },
}));
jest.mock('@platform/health', () => ({
  HealthModule: class HealthModule {},
}));
jest.mock('@platform/http', () => ({
  HttpModule: class HttpModule {},
}));
jest.mock('@platform/observability/logging', () => ({
  LoggingModule: class LoggingModule {},
}));

import { CoreModule } from './core.module';
import { ConditionalModule } from '@nestjs/config';
import { TicketModule } from '@modules/ticket/ticket.module';

describe('CoreModule runtime services', () => {
  test('opts into public Tickets only when explicitly enabled', () => {
    const predicate = jest.mocked(ConditionalModule.registerWhen).mock
      .calls[0][1];
    if (typeof predicate !== 'function')
      throw new Error('Explicit predicate required');
    expect(ConditionalModule.registerWhen).toHaveBeenCalledWith(
      TicketModule,
      predicate,
      { debug: false },
    );
    expect(predicate({})).toBe(false);
    expect(predicate({ TICKET_API_ENABLED: 'false' })).toBe(false);
    expect(predicate({ TICKET_API_ENABLED: 'true' })).toBe(true);
  });
  /** It registers a host-owned runner so committed Outbox facts reach Audit in a running API. */
  test('registers the Outbox relay scheduler with the Core host', () => {
    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      CoreModule,
    ) ?? []) as unknown[];

    expect(
      providers.some(
        (provider) =>
          typeof provider === 'function' &&
          provider.name === 'OutboxRelayScheduler',
      ),
    ).toBe(true);
  });
});
