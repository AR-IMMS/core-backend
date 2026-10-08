import type { EventConsumerDispatchPort } from './ports/event-consumer.port';
import type {
  OutboxDeliveryPort,
  RetryableDeliveryFailure,
} from './ports/outbox-delivery.port';

const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 5 * 60 * 1_000;

export interface OutboxRelayRunResult {
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
}

/**
 * Delivers a bounded batch for each registered consumer. Handler failures use
 * exponential retry delays starting at one second and capped at five minutes.
 * Failed delivery acknowledgements remain claimed until their lease expires,
 * allowing at-least-once redelivery without misclassifying a successful handler.
 */
export class OutboxRelayService {
  constructor(
    private readonly outbox: OutboxDeliveryPort,
    private readonly dispatch: EventConsumerDispatchPort,
    private readonly batchSize = 100,
  ) {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
      throw new RangeError('Relay batch size must be a positive safe integer');
    }
  }

  async runOnce(now: Date = new Date()): Promise<OutboxRelayRunResult> {
    const result = { claimed: 0, delivered: 0, failed: 0 };

    for (const consumer of this.dispatch.registrations()) {
      const claims = await this.outbox.claimEligibleDeliveries({
        now,
        limit: this.batchSize,
        consumerId: consumer.consumerId,
        subscriptions: consumer.subscriptions,
      });
      result.claimed += claims.length;

      for (const claim of claims) {
        try {
          await this.dispatch.dispatch(consumer.consumerId, claim.fact);
        } catch {
          const failure = this.retryableFailure(claim.attemptCount, now);
          await this.outbox.markRetryableFailure(claim, failure);
          result.failed += 1;
          continue;
        }

        await this.outbox.markDelivered(claim, now);
        result.delivered += 1;
      }
    }

    return result;
  }

  private retryableFailure(
    attemptCount: number,
    failedAt: Date,
  ): RetryableDeliveryFailure {
    const backoffExponent = Math.max(0, attemptCount - 1);
    const delayMs = Math.min(
      BASE_RETRY_DELAY_MS * 2 ** backoffExponent,
      MAX_RETRY_DELAY_MS,
    );

    return {
      failedAt,
      nextAttemptAt: new Date(failedAt.getTime() + delayMs),
    };
  }
}
