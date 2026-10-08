import type {
  EventConsumerDispatchPort,
  EventConsumerPort,
  EventConsumerRegistration,
} from './ports/event-consumer.port';
import type { BusinessFactEnvelope } from '../domain/business-fact-envelope';

/** Explicit allowlist registry for consumers supported by module composition. */
export class EventConsumerRegistry implements EventConsumerDispatchPort {
  private readonly consumersById = new Map<
    string,
    {
      readonly subscriptions: readonly EventConsumerPort['subscriptions'][number][];
      readonly handle: EventConsumerPort['handle'];
    }
  >();
  private readonly consumerRegistrations: readonly EventConsumerRegistration[];

  constructor(consumers: readonly EventConsumerPort[]) {
    const registrations: EventConsumerRegistration[] = [];

    for (const consumer of consumers) {
      const consumerId = consumer.consumerId.trim();
      if (consumerId.length === 0) {
        throw new TypeError('Consumer identifiers must not be empty');
      }
      if (this.consumersById.has(consumerId)) {
        throw new Error(
          `Consumer identifier "${consumerId}" is registered more than once`,
        );
      }
      const subscriptions = consumer.subscriptions.map((subscription) => {
        if (
          subscription.eventType.trim().length === 0 ||
          subscription.eventType.includes('*')
        ) {
          throw new TypeError(
            `Consumer "${consumerId}" must declare explicit event types`,
          );
        }
        if (
          !Number.isSafeInteger(subscription.eventVersion) ||
          subscription.eventVersion < 1
        ) {
          throw new TypeError(
            `Consumer "${consumerId}" has an invalid event version`,
          );
        }
        return {
          eventType: subscription.eventType,
          eventVersion: subscription.eventVersion,
        };
      });
      const subscriptionKeys = subscriptions.map(
        ({ eventType, eventVersion }) => `${eventType}:${eventVersion}`,
      );
      if (new Set(subscriptionKeys).size !== subscriptionKeys.length) {
        throw new Error(
          `Consumer "${consumerId}" declares a subscription more than once`,
        );
      }

      this.consumersById.set(consumerId, {
        subscriptions,
        handle: (fact) => consumer.handle(fact),
      });
      registrations.push({ consumerId, subscriptions });
    }

    this.consumerRegistrations = registrations;
  }

  registrations(): readonly EventConsumerRegistration[] {
    return this.consumerRegistrations.map((registration) => ({
      consumerId: registration.consumerId,
      subscriptions: registration.subscriptions.map((subscription) => ({
        eventType: subscription.eventType,
        eventVersion: subscription.eventVersion,
      })),
    }));
  }

  async dispatch(
    consumerId: string,
    fact: BusinessFactEnvelope,
  ): Promise<void> {
    const registeredConsumer = this.consumersById.get(consumerId);
    if (!registeredConsumer) {
      throw new Error(`Consumer "${consumerId}" is not registered`);
    }

    const isSupported = registeredConsumer.subscriptions.some(
      (subscription) =>
        subscription.eventType === fact.event_type &&
        subscription.eventVersion === fact.event_version,
    );
    if (!isSupported) {
      throw new Error(
        `Consumer "${consumerId}" does not support ${fact.event_type} version ${fact.event_version}`,
      );
    }

    await registeredConsumer.handle(fact);
  }
}
