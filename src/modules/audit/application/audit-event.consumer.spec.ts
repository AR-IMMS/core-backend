import { AuditEventConsumer } from './audit-event.consumer';
import {
  AUDIT_FACT_EVENT_TYPE,
  AUDIT_FACT_EVENT_VERSION,
  AUDIT_FACT_EVENT_VERSION_V2,
  businessFactVersion,
  type AuditFact,
  type AuditFactV2,
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

const auditFactV2: AuditFactV2 = {
  ...auditFact,
  event_version: AUDIT_FACT_EVENT_VERSION_V2,
  payload: {
    actor: { type: 'user', id: 'user-1' },
    action: 'iam.user.permissions_replaced',
    changes: [
      {
        field: 'additional_permissions',
        before: ['user:read'],
        after: ['asset:read', 'user:read'],
      },
    ],
  },
};

const permissionCatalog = {
  isKnownPermissionCode: (code: string) =>
    ['user:read', 'asset:read'].includes(code),
};

describe('AuditEventConsumer', () => {
  /** It subscribes to both explicitly supported Audit Fact versions. */
  test('subscribes only to the shared Audit Fact contract', () => {
    const consumer = new AuditEventConsumer(
      {
        appendIfAbsent: jest.fn().mockResolvedValue('inserted'),
      },
      permissionCatalog,
    );

    expect(consumer.subscriptions).toEqual([
      {
        eventType: 'audit.fact',
        eventVersion: businessFactVersion(1),
      },
      {
        eventType: 'audit.fact',
        eventVersion: businessFactVersion(2),
      },
    ]);
  });

  /** It persists the supplied neutral actor, action, resource, context, and changes. */
  test('persists the supplied neutral actor, action, resource, context, and changes', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );

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

  /** It stores a v2 permission transition as one fact with array values preserved. */
  test('persists v2 permission changes without coercing arrays', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );

    await consumer.handle(auditFactV2);

    expect(appendIfAbsent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventVersion: 2,
        changes: [
          {
            field: 'additional_permissions',
            before: ['user:read'],
            after: ['asset:read', 'user:read'],
          },
        ],
      }),
    );
  });

  /** It rejects catalog-unknown v2 permission codes before writing an Audit record. */
  test('rejects a v2 permission code that is absent from the catalog', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );
    const invalidFact: AuditFactV2 = {
      ...auditFactV2,
      payload: {
        ...auditFactV2.payload,
        changes: [
          {
            field: 'additional_permissions',
            after: ['user:unknown'],
          },
        ],
      },
    };

    await expect(consumer.handle(invalidFact)).rejects.toThrow(
      'is not in the permission catalog',
    );
    expect(appendIfAbsent).not.toHaveBeenCalled();
  });

  /** It treats a successfully stored duplicate as a completed delivery. */
  test('treats a successfully stored duplicate as a completed delivery', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('duplicate');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );

    await expect(consumer.handle(auditFact)).resolves.toBeUndefined();

    expect(appendIfAbsent.mock.calls).toHaveLength(1);
  });

  /** It rejects non-Audit Facts rather than mapping business facts. */
  test('rejects non-Audit Facts rather than mapping business facts', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );

    await expect(
      consumer.handle({
        ...auditFact,
        event_type: 'asset.registered',
        event_version: businessFactVersion(1),
      }),
    ).rejects.toThrow('Audit only accepts audit.fact versions 1 and 2');

    expect(appendIfAbsent.mock.calls).toHaveLength(0);
  });

  /** It rejects sensitive or snapshot-shaped changes. */
  test('rejects sensitive or snapshot-shaped changes', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );
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

  /** It rejects unrestricted object snapshots in before/after values. */
  test('rejects unrestricted object snapshots in before/after values', async () => {
    const appendIfAbsent = jest.fn().mockResolvedValue('inserted');
    const consumer = new AuditEventConsumer(
      { appendIfAbsent },
      permissionCatalog,
    );
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
