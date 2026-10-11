import type { BusinessFactSubscription } from './event-consumer.port';
import type { BusinessFactEnvelope } from '../../domain/business-fact-envelope';

/** A transport-neutral claim on one fact's delivery to one consumer. */
export interface OutboxDeliveryClaim {
  readonly claimId: string;
  readonly fact: BusinessFactEnvelope;
  readonly consumerId: string;
  readonly attemptCount: number;
  readonly leaseExpiresAt: Date;
}

/** Query used by a relay to request work eligible at a particular instant. */
export interface EligibleDeliveryQuery {
  readonly now: Date;
  readonly limit: number;
  readonly consumerId: string;
  readonly subscriptions: readonly BusinessFactSubscription[];
}

/** Retry timing recorded when a consumer attempt fails. */
export interface RetryableDeliveryFailure {
  readonly failedAt: Date;
  readonly nextAttemptAt: Date;
}

/**
 * Persistence-facing delivery operations used by the relay. Implementations
 * keep progress independent for each event and consumer pair.
 */
export interface OutboxDeliveryPort {
  claimEligibleDeliveries(
    query: EligibleDeliveryQuery,
  ): Promise<readonly OutboxDeliveryClaim[]>;

  markDelivered(claim: OutboxDeliveryClaim, completedAt: Date): Promise<void>;

  markRetryableFailure(
    claim: OutboxDeliveryClaim,
    failure: RetryableDeliveryFailure,
  ): Promise<void>;
}
