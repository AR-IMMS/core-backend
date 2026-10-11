import { AuditEventConsumer } from './audit-event.consumer';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  businessFactVersion,
  type AuditFact,
  type BusinessFactEnvelope,
} from '@platform/events';

const auditFact: AuditFact = {
  event_id: 'event-1',
  event_type: AUDIT_FACT_EVENT_TYPE,
  event_version: AUDIT_FACT_EVENT_VERSION,
  producer: 'asset',
  occurred_at: '2026-10-08T00:00:00.000Z',
  resource: { type: 'asset', id: 'asset-1', sequence: 1 },
  payload: {
    actor: { type: 'user', id: 'user-1' },
    action: 'asset.registered',
    changes: [{ field: 'name', before: null, after: 'Storage node' }],
  },
  context: { request_id: 'request-1' },
};

describe('AuditEventConsumer', () => {
  test('subscribes only to the shared Audit Fact contract', () => {
    const consumer = new AuditEventConsumer({
      appendIfAbsent: jest.fn().mockResolvedValue('inserted'),
    });

    expect(consumer.subscriptions).toEqual([
      {
        eventType: 'audit.fact',
        eventVersion: businessFactVersion(1),
      },
    ]);
  });

  test('persists the supplied neutral actor, action, resource, context, and changes', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer({ appendIfAbsent });

    await consumer.handle(auditFact);

    expect(appendIfAbsent.mock.calls).toEqual([
      [
        {
          eventId: 'event-1',
          eventType: 'audit.fact',
          eventVersion: 1,
          producer: 'asset',
          actor: { type: 'user', id: 'user-1' },
          action: 'asset.registered',
          resource: { type: 'asset', id: 'asset-1' },
          occurredAt: new Date('2026-10-08T00:00:00.000Z'),
          context: { request_id: 'request-1' },
          changes: [{ field: 'name', before: null, after: 'Storage node' }],
        },
      ],
    ]);
  });

  test('treats a successfully stored duplicate as a completed delivery', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('duplicate');
    const consumer = new AuditEventConsumer({ appendIfAbsent });

    await expect(consumer.handle(auditFact)).resolves.toBeUndefined();

    expect(appendIfAbsent.mock.calls).toHaveLength(1);
  });

  test('rejects non-Audit Facts rather than mapping business facts', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer({ appendIfAbsent });

    await expect(
      consumer.handle({
        ...auditFact,
        event_type: 'asset.registered',
        event_version: businessFactVersion(1),
      }),
    ).rejects.toThrow('Audit only accepts audit.fact version 1');

    expect(appendIfAbsent.mock.calls).toHaveLength(0);
  });

  test('rejects sensitive or snapshot-shaped changes', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer({ appendIfAbsent });
    const unsafeFact: BusinessFactEnvelope = {
      ...auditFact,
      payload: {
        ...auditFact.payload,
        changes: [{ field: 'passwordHash', after: 'secret-value' }],
      },
    };

    await expect(consumer.handle(unsafeFact)).rejects.toThrow(
      'Audit change field "passwordHash" is not permitted',
    );

    expect(appendIfAbsent.mock.calls).toHaveLength(0);
  });

  test('rejects unrestricted object snapshots in before/after values', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer({ appendIfAbsent });
    const snapshotFact: BusinessFactEnvelope = {
      ...auditFact,
      payload: {
        ...auditFact.payload,
        changes: [{ field: 'profile', after: { name: 'snapshot' } }],
      },
    };

    await expect(consumer.handle(snapshotFact)).rejects.toThrow(
      'Audit change "profile" after must be a scalar value',
    );

    expect(appendIfAbsent.mock.calls).toHaveLength(0);
  });
});
