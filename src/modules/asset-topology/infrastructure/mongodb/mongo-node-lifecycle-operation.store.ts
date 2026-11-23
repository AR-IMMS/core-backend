import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type { AssetActor } from '../../application/assets/asset-registration.use-case';
import {
  NodeLifecycleConflictError,
  NodeLifecycleIdempotencyConflictError,
  NodeLifecycleOperationUnavailableError,
} from '../../application/lifecycle/node-lifecycle.errors';
import type {
  NodeLifecycleAction,
  NodeLifecycleOperation,
  NodeLifecycleOperationPort,
  NodeLifecycleStage,
} from '../../application/lifecycle/node-lifecycle-operation.port';
import { assetMongoCollection } from './asset-mongo.types';

const COLLECTION = 'asset_topology_node_lifecycle_operations';

@Injectable()
export class MongoNodeLifecycleOperationStore implements NodeLifecycleOperationPort {
  private readonly operations: ReturnType<typeof assetMongoCollection>;

  constructor(@InjectConnection() connection: Connection) {
    this.operations = assetMongoCollection(connection, COLLECTION);
  }

  async begin(input: {
    readonly operationId: string;
    readonly nodeId: string;
    readonly action: NodeLifecycleAction;
    readonly actor: AssetActor;
    readonly idempotencyHash: string | null;
    readonly fingerprint: string;
    readonly now: Date;
  }): Promise<{
    readonly created: boolean;
    readonly operation: NodeLifecycleOperation;
  }> {
    const active = { stage: { $ne: 'COMPLETE' } };
    const existing = input.idempotencyHash
      ? await this.operations.findOne({
          idempotencyHash: input.idempotencyHash,
        })
      : await this.operations.findOne({
          nodeId: input.nodeId,
          action: input.action,
          actorId: input.actor.id,
          ...active,
        });
    if (existing) {
      const operation = parseOperation(existing);
      if (
        operation.nodeId !== input.nodeId ||
        operation.action !== input.action ||
        operation.actorId !== input.actor.id ||
        operation.fingerprint !== input.fingerprint
      ) {
        throw new NodeLifecycleIdempotencyConflictError();
      }
      return { created: false, operation };
    }
    const inFlight = await this.operations.findOne({
      nodeId: input.nodeId,
      ...active,
    });
    if (inFlight)
      throw new NodeLifecycleConflictError(
        parseOperation(inFlight).operationId,
      );
    const document = {
      operationId: input.operationId,
      nodeId: input.nodeId,
      action: input.action,
      actorId: input.actor.id,
      idempotencyHash: input.idempotencyHash,
      fingerprint: input.fingerprint,
      stage: 'GATE_CLOSE_PENDING' satisfies NodeLifecycleStage,
      createdAt: input.now,
      updatedAt: input.now,
    };
    try {
      await this.operations.insertOne(document);
    } catch (error) {
      if (!isDuplicate(error))
        throw new NodeLifecycleOperationUnavailableError();
      const winner = await this.operations.findOne(
        input.idempotencyHash
          ? { idempotencyHash: input.idempotencyHash }
          : { nodeId: input.nodeId, stage: { $ne: 'COMPLETE' } },
      );
      if (!winner) throw new NodeLifecycleOperationUnavailableError();
      const operation = parseOperation(winner);
      if (
        input.idempotencyHash &&
        operation.idempotencyHash !== input.idempotencyHash
      ) {
        throw new NodeLifecycleConflictError(operation.operationId);
      }
      if (
        operation.actorId !== input.actor.id ||
        operation.fingerprint !== input.fingerprint
      ) {
        if (input.idempotencyHash)
          throw new NodeLifecycleIdempotencyConflictError();
        throw new NodeLifecycleConflictError(operation.operationId);
      }
      return { created: false, operation };
    }
    return { created: true, operation: parseOperation(document) };
  }

  async findById(operationId: string): Promise<NodeLifecycleOperation | null> {
    const found = await this.operations.findOne({ operationId });
    return found ? parseOperation(found) : null;
  }

  async findPending(input: {
    readonly nodeId?: string;
    readonly limit: number;
  }): Promise<readonly NodeLifecycleOperation[]> {
    const found = await this.operations
      .find({
        stage: { $ne: 'COMPLETE' },
        ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      })
      .sort({ createdAt: 1 })
      .limit(input.limit)
      .toArray();
    return found.map(parseOperation);
  }

  async recordGate(
    operationId: string,
    gate: NodeLifecycleOperation['gate'],
    now: Date,
  ): Promise<void> {
    if (!gate) throw new NodeLifecycleOperationUnavailableError();
    const result = await this.operations.updateOne(
      { operationId, stage: 'GATE_CLOSE_PENDING' },
      { $set: { gate, stage: 'CORE_CHANGE_PENDING', updatedAt: now } },
    );
    if (result.matchedCount === 0) {
      const current = await this.findById(operationId);
      if (current?.gate?.version === gate.version) return;
      throw new NodeLifecycleOperationUnavailableError();
    }
  }

  async recordFailure(
    operationId: string,
    safeError: string,
    now: Date,
  ): Promise<void> {
    await this.operations.updateOne(
      { operationId, stage: { $ne: 'COMPLETE' } },
      { $set: { safeError: safeError.slice(0, 80), updatedAt: now } },
    );
  }

  async recordOutcome(
    input: {
      readonly operationId: string;
      readonly outcome: 'COMMIT' | 'ABORT';
      readonly safeError?: string;
      readonly now: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<void> {
    const stage =
      input.outcome === 'COMMIT'
        ? 'COMMIT_PENDING_GATE_FINALIZE'
        : 'ABORT_PENDING_GATE_RESTORE';
    const result = await this.operations.updateOne(
      {
        operationId: input.operationId,
        stage: { $in: ['CORE_CHANGE_PENDING', stage] },
      },
      {
        $set: {
          outcome: input.outcome,
          stage,
          ...(input.safeError ? { safeError: input.safeError } : {}),
          updatedAt: input.now,
        },
      },
      { session: context },
    );
    if (result.matchedCount !== 1)
      throw new NodeLifecycleOperationUnavailableError();
  }

  async markComplete(operationId: string, now: Date): Promise<void> {
    const result = await this.operations.updateOne(
      {
        operationId,
        stage: {
          $in: ['COMMIT_PENDING_GATE_FINALIZE', 'ABORT_PENDING_GATE_RESTORE'],
        },
      },
      { $set: { stage: 'COMPLETE', updatedAt: now } },
    );
    if (result.matchedCount !== 1) {
      const current = await this.findById(operationId);
      if (current?.stage !== 'COMPLETE')
        throw new NodeLifecycleOperationUnavailableError();
    }
  }
}

function parseOperation(
  document: Record<string, unknown>,
): NodeLifecycleOperation {
  const stage = document['stage'];
  if (
    typeof document['operationId'] !== 'string' ||
    typeof document['nodeId'] !== 'string' ||
    typeof document['actorId'] !== 'string' ||
    (document['action'] !== 'RETIRE' && document['action'] !== 'UNMAP') ||
    typeof stage !== 'string' ||
    !(document['createdAt'] instanceof Date) ||
    !(document['updatedAt'] instanceof Date)
  )
    throw new NodeLifecycleOperationUnavailableError();
  const validStages: readonly NodeLifecycleStage[] = [
    'GATE_CLOSE_PENDING',
    'CORE_CHANGE_PENDING',
    'COMMIT_PENDING_GATE_FINALIZE',
    'ABORT_PENDING_GATE_RESTORE',
    'COMPLETE',
  ];
  if (!validStages.includes(stage as NodeLifecycleStage))
    throw new NodeLifecycleOperationUnavailableError();
  const gate = document['gate'];
  if (
    gate !== undefined &&
    (!isRecord(gate) ||
      typeof gate['nodeId'] !== 'string' ||
      typeof gate['operationId'] !== 'string' ||
      typeof gate['version'] !== 'number' ||
      (gate['previousState'] !== 'OPEN' && gate['previousState'] !== 'CLOSED'))
  )
    throw new NodeLifecycleOperationUnavailableError();
  return {
    operationId: document['operationId'],
    nodeId: document['nodeId'],
    action: document['action'],
    actorId: document['actorId'],
    idempotencyHash:
      typeof document['idempotencyHash'] === 'string'
        ? document['idempotencyHash']
        : null,
    fingerprint:
      typeof document['fingerprint'] === 'string'
        ? document['fingerprint']
        : '',
    stage: stage as NodeLifecycleStage,
    ...(isRecord(gate)
      ? { gate: gate as unknown as NodeLifecycleOperation['gate'] }
      : {}),
    ...(document['outcome'] === 'COMMIT' || document['outcome'] === 'ABORT'
      ? { outcome: document['outcome'] }
      : {}),
    ...(typeof document['safeError'] === 'string'
      ? { safeError: document['safeError'] }
      : {}),
    createdAt: document['createdAt'],
    updatedAt: document['updatedAt'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isDuplicate(error: unknown): boolean {
  return isRecord(error) && error['code'] === 11000;
}
