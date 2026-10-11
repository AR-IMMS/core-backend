import type { BusinessFactSubscription } from '../../application/ports/event-consumer.port';
import type { UnitOfWorkContext } from '../../application/ports/unit-of-work.port';
import {
  businessFactVersion,
  type BusinessFactEnvelope,
} from '../../domain/business-fact-envelope';
import { OutboxEntrySchema } from './outbox.schema';
import { MongoOutboxStore, type MongoOutboxModel } from './mongo-outbox.store';

jest.mock('node:crypto', () => ({ randomUUID: () => 'claim-1' }));

const fact: BusinessFactEnvelope<{ readonly changed: true }> = {
  event_id: 'event-1',
  event_type: 'asset.updated',
  event_version: businessFactVersion(1),
  producer: 'asset',
  occurred_at: '2026-10-08T00:00:00.000Z',
  resource: {
    type: 'asset',
    id: 'asset-1',
    sequence: 1,
  },
  payload: { changed: true },
  context: {},
};

class FakeQuery<TResult> {
  constructor(private readonly result: TResult) {}

  select(): this {
    return this;
  }

  sort(): this {
    return this;
  }

  limit(): this {
    return this;
  }

  lean(): this {
    return this;
  }

  exec(): Promise<TResult> {
    return Promise.resolve(this.result);
  }
}

class FakeCursor<TResult> implements AsyncIterable<TResult> {
  constructor(private readonly entries: readonly TResult[]) {}

  async *[Symbol.asyncIterator](): AsyncGenerator<TResult> {
    for (const entry of this.entries) {
      await Promise.resolve();
      yield entry;
    }
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeCursorQuery<TResult> {
  constructor(private readonly entries: readonly TResult[]) {}

  select(): this {
    return this;
  }

  sort(): this {
    return this;
  }

  lean(): this {
    return this;
  }

  cursor(): FakeCursor<TResult> {
    return new FakeCursor(this.entries);
  }
}

describe('MongoOutboxStore', () => {
  test('appends the fact using the Unit of Work MongoDB session', async () => {
    const session = { inTransaction: () => true };
    const create = jest.fn().mockResolvedValue([]);
    const store = new MongoOutboxStore({
      create,
    } as unknown as MongoOutboxModel);
    const context = session as unknown as UnitOfWorkContext;

    await store.append(fact, context);

    expect(create).toHaveBeenCalledWith(
      [
        {
          fact,
          deliveries: [],
        },
      ],
      { session },
    );
  });

  test('seeds and claims a delivery only for the matching consumer subscription', async () => {
    const pendingDelivery = {
      consumerId: 'audit',
      state: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date('2026-10-08T00:00:00.000Z'),
    };
    const claimedDelivery = {
      ...pendingDelivery,
      state: 'claimed',
      attemptCount: 1,
      claimId: 'claim-1',
      leaseExpiresAt: new Date('2026-10-08T00:00:30.000Z'),
    };
    const updateOne = jest.fn().mockReturnValue(
      new FakeQuery({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
      }),
    );
    const find = jest
      .fn()
      .mockReturnValueOnce(
        new FakeQuery([{ _id: 'entry-1', fact, deliveries: [] }]),
      )
      .mockReturnValueOnce(
        new FakeCursorQuery([
          { _id: 'entry-1', fact, deliveries: [pendingDelivery] },
        ]),
      );
    const orderingFilters: unknown[] = [];
    const findOne = jest.fn((filter: unknown) => {
      orderingFilters.push(filter);
      return new FakeQuery(null);
    });
    const claimFilters: unknown[] = [];
    const findOneAndUpdate = jest.fn((filter: unknown) => {
      claimFilters.push(filter);
      return new FakeQuery({
        _id: 'entry-1',
        fact,
        deliveries: [claimedDelivery],
      });
    });
    const store = new MongoOutboxStore({
      find,
      findOne,
      findOneAndUpdate,
      updateOne,
    } as unknown as MongoOutboxModel);
    const subscriptions: readonly BusinessFactSubscription[] = [
      {
        eventType: fact.event_type,
        eventVersion: fact.event_version,
      },
    ];

    const claims = await store.claimEligibleDeliveries({
      now: new Date('2026-10-08T00:00:00.000Z'),
      limit: 10,
      consumerId: 'audit',
      subscriptions,
    });

    expect(claims).toEqual([
      {
        claimId: 'claim-1',
        fact,
        consumerId: 'audit',
        attemptCount: 1,
        leaseExpiresAt: new Date('2026-10-08T00:00:30.000Z'),
      },
    ]);
    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: 'entry-1',
        deliveries: { $not: { $elemMatch: { consumerId: 'audit' } } },
      },
      {
        $push: {
          deliveries: {
            consumerId: 'audit',
            state: 'pending',
            attemptCount: 0,
            nextAttemptAt: new Date('2026-10-08T00:00:00.000Z'),
          },
        },
      },
    );
    expect(claimFilters[0]).toMatchObject({
      'fact.event_id': fact.event_id,
      deliveries: {
        $elemMatch: {
          consumerId: 'audit',
        },
      },
    });
    expect(orderingFilters[0]).toMatchObject({
      'fact.resource.type': 'asset',
      'fact.resource.id': 'asset-1',
      'fact.resource.sequence': { $lt: 1 },
      deliveries: {
        $elemMatch: {
          consumerId: 'audit',
          state: { $ne: 'delivered' },
        },
      },
    });
  });

  test('lets an independent resource progress while an earlier sequence is incomplete', async () => {
    const blockedFact = {
      ...fact,
      event_id: 'event-blocked',
      resource: { ...fact.resource, sequence: 2 },
    };
    const independentFact = {
      ...fact,
      event_id: 'event-independent',
      resource: { ...fact.resource, id: 'asset-2', sequence: 1 },
    };
    const pendingDelivery = {
      consumerId: 'audit',
      state: 'pending',
      attemptCount: 0,
      nextAttemptAt: new Date('2026-10-08T00:00:00.000Z'),
    };
    const claimedDelivery = {
      ...pendingDelivery,
      state: 'claimed',
      attemptCount: 1,
      claimId: 'claim-1',
      leaseExpiresAt: new Date('2026-10-08T00:00:30.000Z'),
    };
    const find = jest
      .fn()
      .mockReturnValueOnce(new FakeQuery([]))
      .mockReturnValueOnce(
        new FakeCursorQuery([
          {
            _id: 'entry-blocked',
            fact: blockedFact,
            deliveries: [pendingDelivery],
          },
          {
            _id: 'entry-independent',
            fact: independentFact,
            deliveries: [pendingDelivery],
          },
        ]),
      );
    const findOne = jest
      .fn()
      .mockReturnValueOnce(new FakeQuery({ _id: 'earlier-sequence' }))
      .mockReturnValueOnce(new FakeQuery(null));
    const findOneAndUpdate = jest.fn().mockReturnValue(
      new FakeQuery({
        _id: 'entry-independent',
        fact: independentFact,
        deliveries: [claimedDelivery],
      }),
    );
    const store = new MongoOutboxStore({
      find,
      findOne,
      findOneAndUpdate,
    } as unknown as MongoOutboxModel);

    const claims = await store.claimEligibleDeliveries({
      now: new Date('2026-10-08T00:00:00.000Z'),
      limit: 1,
      consumerId: 'audit',
      subscriptions: [
        {
          eventType: fact.event_type,
          eventVersion: fact.event_version,
        },
      ],
    });

    expect(claims).toHaveLength(1);
    expect(claims[0]?.fact.resource.id).toBe('asset-2');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });

  test('completes only the delivery matching the event, consumer, and claim', async () => {
    const updateOne = jest.fn().mockReturnValue({
      exec: () =>
        Promise.resolve({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
        }),
    });
    const store = new MongoOutboxStore({
      updateOne,
    } as unknown as MongoOutboxModel);
    const claim = {
      claimId: 'claim-1',
      fact,
      consumerId: 'audit',
      attemptCount: 1,
      leaseExpiresAt: new Date('2026-10-08T00:01:00.000Z'),
    };
    const completedAt = new Date('2026-10-08T00:00:05.000Z');

    await store.markDelivered(claim, completedAt);

    expect(updateOne).toHaveBeenCalledWith(
      {
        'fact.event_id': fact.event_id,
        deliveries: {
          $elemMatch: {
            consumerId: 'audit',
            claimId: 'claim-1',
            state: 'claimed',
          },
        },
      },
      {
        $set: {
          'deliveries.$.state': 'delivered',
          'deliveries.$.completedAt': completedAt,
          'deliveries.$.claimId': null,
          'deliveries.$.leaseExpiresAt': null,
        },
      },
    );
  });

  test('records retry state only for the failed consumer delivery', async () => {
    const updateOne = jest.fn().mockReturnValue({
      exec: () =>
        Promise.resolve({
          acknowledged: true,
          matchedCount: 1,
          modifiedCount: 1,
        }),
    });
    const store = new MongoOutboxStore({
      updateOne,
    } as unknown as MongoOutboxModel);
    const claim = {
      claimId: 'claim-2',
      fact,
      consumerId: 'audit',
      attemptCount: 2,
      leaseExpiresAt: new Date('2026-10-08T00:01:00.000Z'),
    };
    const failedAt = new Date('2026-10-08T00:00:05.000Z');
    const nextAttemptAt = new Date('2026-10-08T00:00:15.000Z');

    await store.markRetryableFailure(claim, { failedAt, nextAttemptAt });

    expect(updateOne).toHaveBeenCalledWith(
      {
        'fact.event_id': fact.event_id,
        deliveries: {
          $elemMatch: {
            consumerId: 'audit',
            claimId: 'claim-2',
            state: 'claimed',
          },
        },
      },
      {
        $set: {
          'deliveries.$.state': 'retryable',
          'deliveries.$.failedAt': failedAt,
          'deliveries.$.nextAttemptAt': nextAttemptAt,
          'deliveries.$.claimId': null,
          'deliveries.$.leaseExpiresAt': null,
        },
      },
    );
  });

  test('indexes fact identity uniquely and delivery eligibility fields', () => {
    const indexes = OutboxEntrySchema.indexes();

    expect(indexes).toContainEqual([
      { 'fact.event_id': 1 },
      expect.objectContaining({ unique: true }),
    ]);
    expect(indexes).toContainEqual([
      expect.objectContaining({
        'deliveries.state': 1,
        'deliveries.nextAttemptAt': 1,
        'deliveries.leaseExpiresAt': 1,
      }),
      expect.any(Object),
    ]);
  });
});
