import type {
  BusinessFactSubscription,
  EventConsumerDispatchPort,
  EventConsumerPort,
} from './ports/event-consumer.port';
import { EventConsumerRegistry } from './event-consumer.registry';
import {
  businessFactVersion,
  type BusinessFactEnvelope,
} from '../domain/business-fact-envelope';

const versionOne = businessFactVersion(1);
const versionTwo = businessFactVersion(2);
const fact: BusinessFactEnvelope = {
  event_id: 'event-1',
  event_type: 'asset.updated',
  event_version: versionOne,
  producer: 'asset',
  occurred_at: '2026-10-08T00:00:00.000Z',
  resource: { type: 'asset', id: 'asset-1', sequence: 1 },
  payload: { changed: true },
  context: {},
};

function makeConsumer(
  consumerId: string,
  subscriptions: readonly BusinessFactSubscription[],
  handle: EventConsumerPort['handle'] = jest.fn().mockResolvedValue(undefined),
): EventConsumerPort {
  return { consumerId, subscriptions, handle };
}

describe('EventConsumerRegistry', () => {
  test('dispatches matching consumers individually without invoking unrelated ones', async () => {
    const matchingHandler = jest.fn().mockResolvedValue(undefined);
    const secondMatchingHandler = jest.fn().mockResolvedValue(undefined);
    const unrelatedHandler = jest.fn().mockResolvedValue(undefined);
    const supported: BusinessFactSubscription = {
      eventType: 'asset.updated',
      eventVersion: versionOne,
    };
    const registry: EventConsumerDispatchPort = new EventConsumerRegistry([
      makeConsumer('audit', [supported], matchingHandler),
      makeConsumer('search', [supported], secondMatchingHandler),
      makeConsumer(
        'notification',
        [{ eventType: 'asset.deleted', eventVersion: versionOne }],
        unrelatedHandler,
      ),
    ]);

    await registry.dispatch('audit', fact);
    await registry.dispatch('search', fact);

    expect(matchingHandler.mock.calls).toEqual([[fact]]);
    expect(secondMatchingHandler.mock.calls).toEqual([[fact]]);
    expect(unrelatedHandler.mock.calls).toHaveLength(0);
    expect(registry.registrations()).toEqual([
      { consumerId: 'audit', subscriptions: [supported] },
      { consumerId: 'search', subscriptions: [supported] },
      {
        consumerId: 'notification',
        subscriptions: [
          { eventType: 'asset.deleted', eventVersion: versionOne },
        ],
      },
    ]);
  });

  test('rejects a fact version the selected consumer does not declare', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const registry = new EventConsumerRegistry([
      makeConsumer(
        'audit',
        [{ eventType: 'asset.updated', eventVersion: versionTwo }],
        handle,
      ),
    ]);

    await expect(registry.dispatch('audit', fact)).rejects.toThrow(
      'does not support asset.updated version 1',
    );

    expect(handle.mock.calls).toHaveLength(0);
  });

  test('rejects a consumer identifier that was not registered', async () => {
    const registry = new EventConsumerRegistry([
      makeConsumer('audit', [
        { eventType: 'asset.updated', eventVersion: versionOne },
      ]),
    ]);

    await expect(registry.dispatch('search', fact)).rejects.toThrow(
      'Consumer "search" is not registered',
    );
  });

  test('propagates consumer failures so the relay cannot acknowledge them', async () => {
    const handle = jest.fn().mockRejectedValue(new Error('audit unavailable'));
    const registry = new EventConsumerRegistry([
      makeConsumer(
        'audit',
        [{ eventType: 'asset.updated', eventVersion: versionOne }],
        handle,
      ),
    ]);

    await expect(registry.dispatch('audit', fact)).rejects.toThrow(
      'audit unavailable',
    );
  });

  test('rejects duplicate stable consumer identifiers at construction', () => {
    expect(
      () =>
        new EventConsumerRegistry([
          makeConsumer('audit', [
            { eventType: 'asset.updated', eventVersion: versionOne },
          ]),
          makeConsumer('audit', [
            { eventType: 'asset.deleted', eventVersion: versionOne },
          ]),
        ]),
    ).toThrow('Consumer identifier "audit" is registered more than once');
  });

  test('rejects wildcard subscriptions instead of routing arbitrary facts', () => {
    expect(
      () =>
        new EventConsumerRegistry([
          makeConsumer('audit', [
            { eventType: 'asset.*', eventVersion: versionOne },
          ]),
        ]),
    ).toThrow('Consumer "audit" must declare explicit event types');
  });

  test('keeps a consumer with no approved subscriptions unroutable', async () => {
    const handle = jest.fn().mockResolvedValue(undefined);
    const registry = new EventConsumerRegistry([
      makeConsumer('audit', [], handle),
    ]);

    expect(registry.registrations()).toEqual([
      { consumerId: 'audit', subscriptions: [] },
    ]);
    await expect(registry.dispatch('audit', fact)).rejects.toThrow(
      'Consumer "audit" does not support asset.updated version 1',
    );
    expect(handle.mock.calls).toHaveLength(0);
  });
});
