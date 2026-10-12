import type {
  BusinessFactEnvelope,
  BusinessFactVersion,
} from '../../domain/business-fact-envelope';

/** One event type and version a consumer explicitly supports. */
export interface BusinessFactSubscription<
  TEventType extends string = string,
  TVersion extends BusinessFactVersion = BusinessFactVersion,
> {
  /** Exact event type; wildcard subscriptions are unsupported. */
  readonly eventType: TEventType;
  /** Positive contract version handled by the consumer. */
  readonly eventVersion: TVersion;
}

/**
 * Consumer port for one typed Business Fact at a time.
 * @example `class AuditConsumer implements EventConsumerPort<AuditFact> { ... }`
 */
export interface EventConsumerPort<
  TFact extends BusinessFactEnvelope = BusinessFactEnvelope,
> {
  /** Stable, non-empty identifier used for independent delivery progress. */
  readonly consumerId: string;
  /** Exact event type and version pairs accepted by this consumer. */
  readonly subscriptions: readonly BusinessFactSubscription<
    TFact['event_type'],
    TFact['event_version']
  >[];

  /**
   * Applies the fact and resolves only after its durable effect has committed.
   * @param fact Versioned fact matching one declared subscription.
   * @returns Promise fulfilled after the side effect commits; rejection triggers retry.
   * @example `async handle(fact: AuditFact): Promise<void> { await this.audit.append(fact); }`
   */
  handle(fact: TFact): Promise<void>;
}

/** Event types and versions a registered consumer can receive. */
export interface EventConsumerRegistration {
  /** Stable consumer identifier. */
  readonly consumerId: string;
  /** Exact event subscriptions used to initialize delivery progress. */
  readonly subscriptions: readonly BusinessFactSubscription[];
}

/**
 * Resolves registered consumers and awaits their durable handling effects.
 * @example Inject `EVENT_CONSUMER_DISPATCH_PORT` only when dispatch is needed outside the relay.
 */
export interface EventConsumerDispatchPort {
  /**
   * Returns a snapshot of registered consumer identifiers and subscriptions.
   * @returns Consumer registrations in composition order.
   * @example `const consumers = dispatch.registrations()`
   */
  registrations(): readonly EventConsumerRegistration[];
  /**
   * Delivers a fact to a registered consumer that declared its exact type/version.
   * @param consumerId Registered stable consumer identifier.
   * @param fact Fact to deliver.
   * @returns Promise fulfilled after the consumer's durable effect commits.
   * @example `await dispatch.dispatch('audit', fact)`
   */
  dispatch(consumerId: string, fact: BusinessFactEnvelope): Promise<void>;
}
