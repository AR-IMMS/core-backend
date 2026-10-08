import {
  businessFactVersion,
  type BusinessFactEnvelope,
} from './domain/business-fact-envelope';
import type { EventConsumerPort } from './application/ports/event-consumer.port';
import type {
  OutboxDeliveryClaim,
  OutboxDeliveryPort,
} from './application/ports/outbox-delivery.port';
import type { OutboxWriterPort } from './application/ports/outbox-writer.port';
import type {
  UnitOfWorkContext,
  UnitOfWorkPort,
} from './application/ports/unit-of-work.port';

const ASSET_REGISTERED_EVENT_TYPE = 'asset.registered';
const ASSET_REGISTERED_EVENT_VERSION = businessFactVersion(1);

interface AssetRegisteredPayload {
  readonly asset_id: string;
}

type AssetRegisteredFact = BusinessFactEnvelope<
  AssetRegisteredPayload,
  typeof ASSET_REGISTERED_EVENT_TYPE,
  typeof ASSET_REGISTERED_EVENT_VERSION
>;

const assetRegisteredFact: AssetRegisteredFact = {
  event_id: 'event-1',
  event_type: ASSET_REGISTERED_EVENT_TYPE,
  event_version: ASSET_REGISTERED_EVENT_VERSION,
  producer: 'asset',
  occurred_at: '2026-10-08T00:00:00.000Z',
  resource: {
    type: 'asset',
    id: 'asset-1',
    sequence: 1,
  },
  payload: {
    asset_id: 'asset-1',
  },
  context: {
    request_id: 'request-1',
  },
};

describe('Platform Events contracts', () => {
  test('requires Business Fact contract versions to be positive safe integers', () => {
    expect(businessFactVersion(1)).toBe(1);
    expect(() => businessFactVersion(0)).toThrow(RangeError);
    expect(() => businessFactVersion(-1)).toThrow(RangeError);
    expect(() => businessFactVersion(1.5)).toThrow(RangeError);
  });

  test('passes an opaque Unit of Work context to the Outbox writer', async () => {
    const context = Symbol(
      'unit-of-work-context',
    ) as unknown as UnitOfWorkContext;
    const append = jest.fn(
      (fact: BusinessFactEnvelope, transactionContext: UnitOfWorkContext) => {
        void fact;
        void transactionContext;
        return Promise.resolve();
      },
    );
    const outboxWriter: OutboxWriterPort = { append };
    const unitOfWork: UnitOfWorkPort = {
      run: (operation) => operation(context),
    };

    await unitOfWork.run((transactionContext) =>
      outboxWriter.append(assetRegisteredFact, transactionContext),
    );

    expect(append).toHaveBeenCalledWith(assetRegisteredFact, context);
  });

  test('lets a consumer declare a version and handle its typed fact', async () => {
    const handledAssetIds: string[] = [];
    const consumer: EventConsumerPort<AssetRegisteredFact> = {
      consumerId: 'audit',
      subscriptions: [
        {
          eventType: ASSET_REGISTERED_EVENT_TYPE,
          eventVersion: ASSET_REGISTERED_EVENT_VERSION,
        },
      ],
      handle: (fact) => {
        handledAssetIds.push(fact.payload.asset_id);
        return Promise.resolve();
      },
    };

    await consumer.handle(assetRegisteredFact);

    expect(consumer.subscriptions).toEqual([
      {
        eventType: ASSET_REGISTERED_EVENT_TYPE,
        eventVersion: ASSET_REGISTERED_EVENT_VERSION,
      },
    ]);
    expect(handledAssetIds).toEqual(['asset-1']);
  });

  test('defines transport-neutral claims and completion operations for delivery', async () => {
    const claim = {
      claimId: 'claim-1',
      fact: assetRegisteredFact,
      consumerId: 'audit',
      attemptCount: 1,
      leaseExpiresAt: new Date('2026-10-08T00:01:00.000Z'),
    };
    const markDelivered = jest.fn(
      (deliveryClaim: OutboxDeliveryClaim, completedAt: Date) => {
        void deliveryClaim;
        void completedAt;
        return Promise.resolve();
      },
    );
    const deliveryPort: OutboxDeliveryPort = {
      claimEligibleDeliveries: () => Promise.resolve([claim]),
      markDelivered,
      markRetryableFailure: () => Promise.resolve(),
    };

    const [delivery] = await deliveryPort.claimEligibleDeliveries({
      now: new Date('2026-10-08T00:00:00.000Z'),
      limit: 10,
      consumerId: 'audit',
      subscriptions: [
        {
          eventType: ASSET_REGISTERED_EVENT_TYPE,
          eventVersion: ASSET_REGISTERED_EVENT_VERSION,
        },
      ],
    });
    await deliveryPort.markDelivered(delivery, new Date());

    expect(delivery).toBe(claim);
    expect(markDelivered).toHaveBeenCalledWith(delivery, expect.any(Date));
  });
});
