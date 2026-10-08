import type {
  BusinessFactEnvelope,
  BusinessFactVersion,
} from '../../domain/business-fact-envelope';

/** One event type and version a consumer explicitly supports. */
export interface BusinessFactSubscription<
  TEventType extends string = string,
  TVersion extends BusinessFactVersion = BusinessFactVersion,
> {
  readonly eventType: TEventType;
  readonly eventVersion: TVersion;
}

/** Consumer port for one typed Business Fact at a time. */
export interface EventConsumerPort<
  TFact extends BusinessFactEnvelope = BusinessFactEnvelope,
> {
  readonly consumerId: string;
  readonly subscriptions: readonly BusinessFactSubscription<
    TFact['event_type'],
    TFact['event_version']
  >[];

  /** Resolves only after the consumer's durable effect has committed. */
  handle(fact: TFact): Promise<void>;
}

/** Event types and versions a registered consumer can receive. */
export interface EventConsumerRegistration {
  readonly consumerId: string;
  readonly subscriptions: readonly BusinessFactSubscription[];
}

/** Resolves registered consumers and awaits their durable handling effects. */
export interface EventConsumerDispatchPort {
  registrations(): readonly EventConsumerRegistration[];
  dispatch(consumerId: string, fact: BusinessFactEnvelope): Promise<void>;
}
