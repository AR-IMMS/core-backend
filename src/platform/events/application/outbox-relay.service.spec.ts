import type {
  EventConsumerDispatchPort,
  EventConsumerRegistration,
} from './ports/event-consumer.port';
import type {
  OutboxDeliveryClaim,
  OutboxDeliveryPort,
  RetryableDeliveryFailure,
} from './ports/outbox-delivery.port';
import { OutboxRelayService } from './outbox-relay.service';
import {
  businessFactVersion,
  type BusinessFactEnvelope,
} from '../domain/business-fact-envelope';

const occurredAt = '2026-10-08T00:00:00.000Z';
const startTime = new Date(occurredAt);
const subscription = {
  eventType: 'asset.updated',
  eventVersion: businessFactVersion(1),
};

function fact(
  eventId: string,
  resourceId: string,
  sequence: number,
): BusinessFactEnvelope<{ readonly value: number }> {
  return {
    event_id: eventId,
    event_type: 'asset.updated',
    event_version: businessFactVersion(1),
    producer: 'asset',
    occurred_at: occurredAt,
    resource: { type: 'asset', id: resourceId, sequence },
    payload: { value: sequence },
    context: {},
  };
}

function claim(
  event: BusinessFactEnvelope,
  consumerId: string,
  attemptCount = 1,
): OutboxDeliveryClaim {
  return {
    claimId: `claim-${event.event_id}-${consumerId}`,
    fact: event,
    consumerId,
    attemptCount,
    leaseExpiresAt: new Date(startTime.getTime() + 30_000),
  };
}

function consumer(consumerId: string): EventConsumerRegistration {
  return { consumerId, subscriptions: [subscription] };
}

describe('OutboxRelayService', () => {
  test('acknowledges delivery only after its consumer completes', async () => {
    const delivery = claim(fact('event-1', 'asset-1', 1), 'audit');
    const outbox: jest.Mocked<OutboxDeliveryPort> = {
      claimEligibleDeliveries: jest.fn().mockResolvedValue([delivery]),
      markDelivered: jest.fn().mockResolvedValue(undefined),
      markRetryableFailure: jest.fn().mockResolvedValue(undefined),
    };
    const dispatch: jest.Mocked<EventConsumerDispatchPort> = {
      registrations: jest.fn().mockReturnValue([consumer('audit')]),
      dispatch: jest.fn().mockResolvedValue(undefined),
    };
    const relay = new OutboxRelayService(outbox, dispatch, 10);

    const result = await relay.runOnce(startTime);

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(dispatch.dispatch.mock.calls).toEqual([['audit', delivery.fact]]);
    expect(outbox.markDelivered.mock.calls).toEqual([[delivery, startTime]]);
    expect(outbox.markRetryableFailure.mock.calls).toHaveLength(0);
  });

  test('records handler failures for retry and keeps completed consumers complete', async () => {
    const event = fact('event-1', 'asset-1', 1);
    const auditClaim = claim(event, 'audit');
    const searchClaim = claim(event, 'search');
    const outbox: jest.Mocked<OutboxDeliveryPort> = {
      claimEligibleDeliveries: jest
        .fn()
        .mockResolvedValueOnce([auditClaim])
        .mockResolvedValueOnce([searchClaim])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([claim(event, 'search', 2)]),
      markDelivered: jest.fn().mockResolvedValue(undefined),
      markRetryableFailure: jest.fn().mockResolvedValue(undefined),
    };
    const dispatch: jest.Mocked<EventConsumerDispatchPort> = {
      registrations: jest
        .fn()
        .mockReturnValue([consumer('audit'), consumer('search')]),
      dispatch: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('temporary failure'))
        .mockResolvedValueOnce(undefined),
    };
    const relay = new OutboxRelayService(outbox, dispatch, 10);

    const firstRun = await relay.runOnce(startTime);

    expect(firstRun).toEqual({ claimed: 2, delivered: 1, failed: 1 });
    expect(outbox.markDelivered.mock.calls[0]).toEqual([auditClaim, startTime]);
    expect(outbox.markRetryableFailure.mock.calls[0]).toEqual([
      searchClaim,
      {
        failedAt: startTime,
        nextAttemptAt: new Date(startTime.getTime() + 1_000),
      } satisfies RetryableDeliveryFailure,
    ]);

    await relay.runOnce(new Date(startTime.getTime() + 1_000));

    expect(
      dispatch.dispatch.mock.calls.map(([consumerId]) => consumerId),
    ).toEqual(['audit', 'search', 'search']);
    expect(outbox.markDelivered.mock.calls).toHaveLength(2);
  });

  test('does not turn acknowledgement persistence failure into a handler failure', async () => {
    const delivery = claim(fact('event-1', 'asset-1', 1), 'audit');
    const outbox: jest.Mocked<OutboxDeliveryPort> = {
      claimEligibleDeliveries: jest.fn().mockResolvedValue([delivery]),
      markDelivered: jest
        .fn()
        .mockRejectedValue(new Error('Mongo unavailable')),
      markRetryableFailure: jest.fn().mockResolvedValue(undefined),
    };
    const dispatch: jest.Mocked<EventConsumerDispatchPort> = {
      registrations: jest.fn().mockReturnValue([consumer('audit')]),
      dispatch: jest.fn().mockResolvedValue(undefined),
    };
    const relay = new OutboxRelayService(outbox, dispatch, 10);

    await expect(relay.runOnce(startTime)).rejects.toThrow('Mongo unavailable');

    expect(dispatch.dispatch.mock.calls).toHaveLength(1);
    expect(outbox.markRetryableFailure.mock.calls).toHaveLength(0);
  });

  test('asks each consumer for only its subscribed facts', async () => {
    const outbox: jest.Mocked<OutboxDeliveryPort> = {
      claimEligibleDeliveries: jest.fn().mockResolvedValue([]),
      markDelivered: jest.fn().mockResolvedValue(undefined),
      markRetryableFailure: jest.fn().mockResolvedValue(undefined),
    };
    const dispatch: jest.Mocked<EventConsumerDispatchPort> = {
      registrations: jest.fn().mockReturnValue([consumer('audit')]),
      dispatch: jest.fn().mockResolvedValue(undefined),
    };
    const relay = new OutboxRelayService(outbox, dispatch, 7);

    await relay.runOnce(startTime);

    expect(outbox.claimEligibleDeliveries.mock.calls[0]).toEqual([
      {
        now: startTime,
        limit: 7,
        consumerId: 'audit',
        subscriptions: [subscription],
      },
    ]);
  });
});
