import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';

import type {
  EligibleDeliveryQuery,
  OutboxDeliveryClaim,
  OutboxDeliveryPort,
  RetryableDeliveryFailure,
} from '../../application/ports/outbox-delivery.port';
import type { OutboxWriterPort } from '../../application/ports/outbox-writer.port';
import type { UnitOfWorkContext } from '../../application/ports/unit-of-work.port';
import type { BusinessFactEnvelope } from '../../domain/business-fact-envelope';
import type { MongoSession } from './mongo-connection.types';
import { OUTBOX_ENTRY_MODEL } from './outbox.schema';

const DELIVERY_CLAIM_LEASE_MS = 30_000;

const ELIGIBLE_DELIVERY_STATES = ['pending', 'retryable'] as const;

interface DeliveryStateFilter {
  readonly consumerId: string;
  readonly $or: readonly [
    {
      readonly state: { readonly $in: readonly string[] };
      readonly nextAttemptAt: { readonly $lte: Date };
    },
    {
      readonly state: 'claimed';
      readonly leaseExpiresAt: { readonly $lte: Date };
    },
  ];
}

type MongoFilter = Readonly<Record<string, unknown>>;
type MongoUpdate = Readonly<Record<string, unknown>>;

interface OutboxStoredRecord {
  readonly _id: unknown;
  readonly fact: BusinessFactEnvelope;
  readonly deliveries: readonly OutboxDeliveryRecord[];
  readonly createdAt: Date;
}

interface OutboxDeliveryRecord {
  readonly consumerId: string;
  readonly state: string;
  readonly attemptCount: number;
  readonly nextAttemptAt: Date;
  readonly claimId: string | null;
  readonly leaseExpiresAt: Date | null;
}

interface OutboxQuery<TResult> {
  select(fields: string): OutboxQuery<TResult>;
  sort(order: Readonly<Record<string, 1>>): OutboxQuery<TResult>;
  lean(): OutboxQuery<TResult>;
  exec(): Promise<TResult>;
}

interface OutboxFindQuery {
  select(fields: string): OutboxFindQuery;
  sort(order: Readonly<Record<string, 1>>): OutboxFindQuery;
  lean(): OutboxFindQuery;
  exec(): Promise<readonly OutboxStoredRecord[]>;
  cursor(): OutboxCursor<OutboxStoredRecord>;
}

interface OutboxCursor<TRecord> extends AsyncIterable<TRecord> {
  close(): Promise<void>;
}

interface OutboxUpdateQuery {
  exec(): Promise<{ readonly matchedCount: number }>;
}

/** Narrow model surface used by the adapter and provided by Mongoose injection. */
export interface MongoOutboxModel {
  create(
    entries: readonly {
      readonly fact: BusinessFactEnvelope;
      readonly deliveries: readonly [];
    }[],
    options: { readonly session: MongoSession },
  ): Promise<unknown>;
  find(filter: MongoFilter): OutboxFindQuery;
  findOne(filter: MongoFilter): OutboxQuery<OutboxStoredRecord | null>;
  findOneAndUpdate(
    filter: MongoFilter,
    update: MongoUpdate,
    options: { readonly new: true },
  ): OutboxQuery<OutboxStoredRecord | null>;
  updateOne(filter: MongoFilter, update: MongoUpdate): OutboxUpdateQuery;
}

/** MongoDB persistence adapter for producer facts and consumer delivery state. */
@Injectable()
export class MongoOutboxStore implements OutboxWriterPort, OutboxDeliveryPort {
  constructor(
    @InjectModel(OUTBOX_ENTRY_MODEL)
    private readonly outboxModel: MongoOutboxModel,
  ) {}

  async append<TPayload>(
    fact: BusinessFactEnvelope<TPayload>,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const session = context as unknown as MongoSession;
    await this.outboxModel.create(
      [
        {
          fact,
          deliveries: [],
        },
      ],
      { session },
    );
  }

  async claimEligibleDeliveries(
    query: EligibleDeliveryQuery,
  ): Promise<readonly OutboxDeliveryClaim[]> {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1) {
      throw new RangeError(
        'Delivery claim limit must be a positive safe integer',
      );
    }
    if (query.consumerId.trim().length === 0) {
      throw new TypeError('Delivery claims require a consumer identifier');
    }
    if (query.subscriptions.length === 0) {
      return [];
    }

    const matchingFactsFilter: MongoFilter = {
      $or: query.subscriptions.map((subscription) => ({
        'fact.event_type': subscription.eventType,
        'fact.event_version': subscription.eventVersion,
      })),
    };

    await this.initializeConsumerDeliveries(query, matchingFactsFilter);

    const claimCandidates = this.outboxModel
      .find({
        ...matchingFactsFilter,
        deliveries: {
          $elemMatch: this.deliveryStateFilter(query.consumerId, query.now),
        },
      })
      .select('fact deliveries')
      .sort({
        'fact.resource.type': 1,
        'fact.resource.id': 1,
        'fact.resource.sequence': 1,
      })
      .lean()
      .cursor();

    const claims: OutboxDeliveryClaim[] = [];
    try {
      for await (const candidate of claimCandidates) {
        if (claims.length >= query.limit) {
          break;
        }
        if (
          await this.hasEarlierIncompleteDelivery(
            candidate.fact,
            query.consumerId,
          )
        ) {
          continue;
        }

        const claimId = randomUUID();
        const leaseExpiresAt = new Date(
          query.now.getTime() + DELIVERY_CLAIM_LEASE_MS,
        );
        const claimedEntry = await this.outboxModel
          .findOneAndUpdate(
            {
              'fact.event_id': candidate.fact.event_id,
              deliveries: {
                $elemMatch: this.deliveryStateFilter(
                  query.consumerId,
                  query.now,
                ),
              },
            },
            {
              $set: {
                'deliveries.$.state': 'claimed',
                'deliveries.$.claimId': claimId,
                'deliveries.$.claimedAt': query.now,
                'deliveries.$.leaseExpiresAt': leaseExpiresAt,
              },
              $inc: { 'deliveries.$.attemptCount': 1 },
            },
            { new: true },
          )
          .lean()
          .exec();

        const claimedDelivery = claimedEntry?.deliveries.find(
          (delivery) =>
            delivery.consumerId === query.consumerId &&
            delivery.claimId === claimId,
        );
        if (!claimedEntry || !claimedDelivery) {
          continue;
        }

        claims.push({
          claimId,
          fact: claimedEntry.fact,
          consumerId: query.consumerId,
          attemptCount: claimedDelivery.attemptCount,
          leaseExpiresAt,
        });
      }
    } finally {
      await claimCandidates.close();
    }

    return claims;
  }

  async markDelivered(
    claim: OutboxDeliveryClaim,
    completedAt: Date,
  ): Promise<void> {
    const updateResult = await this.outboxModel
      .updateOne(
        {
          'fact.event_id': claim.fact.event_id,
          deliveries: {
            $elemMatch: {
              consumerId: claim.consumerId,
              claimId: claim.claimId,
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
      )
      .exec();

    this.ensureClaimWasUpdated(updateResult.matchedCount);
  }

  async markRetryableFailure(
    claim: OutboxDeliveryClaim,
    failure: RetryableDeliveryFailure,
  ): Promise<void> {
    const updateResult = await this.outboxModel
      .updateOne(
        {
          'fact.event_id': claim.fact.event_id,
          deliveries: {
            $elemMatch: {
              consumerId: claim.consumerId,
              claimId: claim.claimId,
              state: 'claimed',
            },
          },
        },
        {
          $set: {
            'deliveries.$.state': 'retryable',
            'deliveries.$.failedAt': failure.failedAt,
            'deliveries.$.nextAttemptAt': failure.nextAttemptAt,
            'deliveries.$.claimId': null,
            'deliveries.$.leaseExpiresAt': null,
          },
        },
      )
      .exec();

    this.ensureClaimWasUpdated(updateResult.matchedCount);
  }

  private async initializeConsumerDeliveries(
    query: EligibleDeliveryQuery,
    matchingFactsFilter: MongoFilter,
  ): Promise<void> {
    const matchingFacts = await this.outboxModel
      .find(matchingFactsFilter)
      .select('fact deliveries createdAt')
      .lean()
      .exec();

    for (const entry of matchingFacts) {
      if (
        entry.deliveries.some(
          (delivery) => delivery.consumerId === query.consumerId,
        )
      ) {
        continue;
      }

      await this.outboxModel
        .updateOne(
          {
            _id: entry._id,
            deliveries: {
              $not: { $elemMatch: { consumerId: query.consumerId } },
            },
          },
          {
            $push: {
              deliveries: {
                consumerId: query.consumerId,
                state: 'pending',
                attemptCount: 0,
                nextAttemptAt: entry.createdAt ?? query.now,
              },
            },
          },
        )
        .exec();
    }
  }

  private async hasEarlierIncompleteDelivery(
    fact: BusinessFactEnvelope,
    consumerId: string,
  ): Promise<boolean> {
    const earlierEntry = await this.outboxModel
      .findOne({
        'fact.resource.type': fact.resource.type,
        'fact.resource.id': fact.resource.id,
        'fact.resource.sequence': { $lt: fact.resource.sequence },
        deliveries: {
          $elemMatch: {
            consumerId,
            state: { $ne: 'delivered' },
          },
        },
      })
      .select('_id')
      .lean()
      .exec();

    return earlierEntry !== null;
  }

  private deliveryStateFilter(
    consumerId: string,
    now: Date,
  ): DeliveryStateFilter {
    return {
      consumerId,
      $or: [
        {
          state: { $in: ELIGIBLE_DELIVERY_STATES },
          nextAttemptAt: { $lte: now },
        },
        {
          state: 'claimed',
          leaseExpiresAt: { $lte: now },
        },
      ],
    };
  }

  private ensureClaimWasUpdated(matchedCount: number): void {
    if (matchedCount !== 1) {
      throw new Error('Outbox delivery claim is no longer active');
    }
  }
}
