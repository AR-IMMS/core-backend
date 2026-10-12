import type { BusinessFactSubscription } from './event-consumer.port';
import type { BusinessFactEnvelope } from '../../domain/business-fact-envelope';

/** A transport-neutral claim on one fact's delivery to one consumer. */
export interface OutboxDeliveryClaim {
  /** Unique lease claim identifier required for acknowledgement. */
  readonly claimId: string;
  /** Persisted fact being delivered. */
  readonly fact: BusinessFactEnvelope;
  /** Consumer whose independent progress is being advanced. */
  readonly consumerId: string;
  /** One-based attempt number including this claim. */
  readonly attemptCount: number;
  /** Expiry after which another relay run may reclaim the delivery. */
  readonly leaseExpiresAt: Date;
}

/** Query used by a relay to request work eligible at a particular instant. */
export interface EligibleDeliveryQuery {
  /** Instant used to evaluate retry eligibility and expired leases. */
  readonly now: Date;
  /** Maximum claims returned for this consumer. */
  readonly limit: number;
  /** Consumer whose progress is queried. */
  readonly consumerId: string;
  /** Exact supported event type/version pairs. */
  readonly subscriptions: readonly BusinessFactSubscription[];
}

/** Retry timing recorded when a consumer attempt fails. */
export interface RetryableDeliveryFailure {
  /** Instant the failed attempt was recorded. */
  readonly failedAt: Date;
  /** Earliest instant at which another attempt may be claimed. */
  readonly nextAttemptAt: Date;
}

/**
 * Persistence-facing delivery operations used by the relay. Implementations
 * keep progress independent for each event and consumer pair.
 */
export interface OutboxDeliveryPort {
  /**
   * Claims eligible deliveries for one consumer, preserving resource sequence.
   * @param query Consumer, supported contracts, time and batch limit.
   * @returns Claims with attempt and lease metadata.
   * @example `await delivery.claimEligibleDeliveries(query)`
   */
  claimEligibleDeliveries(
    query: EligibleDeliveryQuery,
  ): Promise<readonly OutboxDeliveryClaim[]>;

  /**
   * Marks an active claim delivered after consumer completion.
   * @param claim Active delivery claim.
   * @param completedAt Completion timestamp.
   * @returns Promise fulfilled after durable acknowledgement.
   * @example `await delivery.markDelivered(claim, new Date())`
   */
  markDelivered(claim: OutboxDeliveryClaim, completedAt: Date): Promise<void>;

  /**
   * Records retry timing for a failed consumer attempt.
   * @param claim Active delivery claim.
   * @param failure Failure and next-attempt timestamps.
   * @returns Promise fulfilled after durable retry state is stored.
   * @example `await delivery.markRetryableFailure(claim, failure)`
   */
  markRetryableFailure(
    claim: OutboxDeliveryClaim,
    failure: RetryableDeliveryFailure,
  ): Promise<void>;
}
