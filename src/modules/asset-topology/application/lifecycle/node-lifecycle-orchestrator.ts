import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { UnitOfWorkContext, UnitOfWorkPort } from '@platform/events';
import { UNIT_OF_WORK_PORT } from '@platform/events';
import type { AgentNodeLifecycleCoordination } from '@modules/agent-management/contracts';
import { AGENT_NODE_LIFECYCLE_COORDINATION_PORT } from '@modules/agent-management/contracts';
import type { AssetActor } from '../assets/asset-registration.use-case';
import type {
  NodeLifecycleOperation,
  NodeLifecycleOperationPort,
  NodeLifecycleAction,
} from './node-lifecycle-operation.port';
import { NODE_LIFECYCLE_OPERATION_PORT } from './node-lifecycle-operation.port';
import {
  NodeLifecycleOperationNotFoundError,
  NodeLifecycleOperationUnavailableError,
} from './node-lifecycle.errors';

export class NodeLifecyclePendingError extends Error {
  constructor(
    readonly operationId: string,
    readonly stage: string,
  ) {
    super('Node lifecycle operation is pending');
    this.name = 'NodeLifecyclePendingError';
  }
}

@Injectable()
export class NodeLifecycleOrchestrator {
  constructor(
    @Inject(NODE_LIFECYCLE_OPERATION_PORT)
    private readonly operations: NodeLifecycleOperationPort,
    @Inject(AGENT_NODE_LIFECYCLE_COORDINATION_PORT)
    private readonly fleet: AgentNodeLifecycleCoordination,
    @Inject(UNIT_OF_WORK_PORT) private readonly unitOfWork: UnitOfWorkPort,
    @Optional() private readonly now: () => Date = () => new Date(),
    @Optional() private readonly generateId: () => string = randomUUID,
  ) {}

  async execute<T>(input: {
    readonly nodeId: string;
    readonly action: NodeLifecycleAction;
    readonly actor: AssetActor;
    readonly beforeChange?: (
      operation: NodeLifecycleOperation,
      actor: AssetActor,
    ) => Promise<void> | void;
    readonly idempotencyKey?: string;
    readonly operationId?: string;
    readonly change: (
      context: UnitOfWorkContext,
      operation: NodeLifecycleOperation,
      actor: AssetActor,
    ) => Promise<T>;
    readonly isBusinessFailure: (error: unknown) => boolean;
    readonly recordAbort: (
      context: UnitOfWorkContext,
      operation: NodeLifecycleOperation,
      actor: AssetActor,
      safeCode: string,
    ) => Promise<void>;
  }): Promise<T | void> {
    const fingerprint = hash(
      `${input.actor.id}\0${input.action}\0${input.nodeId}`,
    );
    const idempotencyHash = input.idempotencyKey
      ? hash(input.idempotencyKey)
      : null;
    let operation: NodeLifecycleOperation;
    if (input.operationId) {
      operation =
        (await this.operations.findById(input.operationId)) ??
        (() => {
          throw new NodeLifecycleOperationNotFoundError();
        })();
      if (
        operation.nodeId !== input.nodeId ||
        operation.action !== input.action
      )
        throw new NodeLifecycleOperationNotFoundError();
    } else {
      operation = (
        await this.operations.begin({
          operationId: this.generateId(),
          nodeId: input.nodeId,
          action: input.action,
          actor: input.actor,
          idempotencyHash,
          fingerprint,
          now: this.now(),
        })
      ).operation;
    }

    // A completed replay is successful and must not close a new Fleet gate.
    if (operation.stage === 'COMPLETE') return;
    let actor = input.actor;
    if (input.operationId && operation.actorId !== input.actor.id) {
      // An authorized operator is retrying; Fleet audit records the verified
      // operator identity while Core business audit retains the original actor.
      actor = { ...input.actor };
    }

    if (operation.stage === 'GATE_CLOSE_PENDING') {
      try {
        const gate = await this.fleet.closeEnrollmentGate({
          nodeId: operation.nodeId,
          operationId: operation.operationId,
          actor: {
            actorId: actor.id,
            requestId: actor.context?.request_id ?? operation.operationId,
          },
        });
        await this.operations.recordGate(
          operation.operationId,
          gate,
          this.now(),
        );
        operation = { ...operation, gate, stage: 'CORE_CHANGE_PENDING' };
      } catch {
        await this.recordFailure(
          operation.operationId,
          'FLEET_GATE_CLOSE_UNAVAILABLE',
        );
        throw new NodeLifecyclePendingError(
          operation.operationId,
          operation.stage,
        );
      }
    }

    if (operation.stage === 'CORE_CHANGE_PENDING') {
      if (input.beforeChange) {
        try {
          await input.beforeChange(operation, actor);
        } catch (error) {
          if (!input.isBusinessFailure(error)) {
            await this.recordFailure(
              operation.operationId,
              safeErrorCode(error),
            );
            throw new NodeLifecyclePendingError(
              operation.operationId,
              operation.stage,
            );
          }
          try {
            await this.unitOfWork.run(async (context) => {
              await input.recordAbort(
                context,
                operation,
                actor,
                safeErrorCode(error),
              );
              await this.operations.recordOutcome(
                {
                  operationId: operation.operationId,
                  outcome: 'ABORT',
                  safeError: safeErrorCode(error),
                  now: this.now(),
                },
                context,
              );
            });
          } catch {
            const persisted = await this.operations.findById(
              operation.operationId,
            );
            if (persisted?.stage === 'ABORT_PENDING_GATE_RESTORE') {
              await this.finalize(persisted, 'ABORT', actor);
              throw error;
            }
            await this.recordFailure(
              operation.operationId,
              'CORE_ABORT_OUTCOME_UNKNOWN',
            );
            throw new NodeLifecyclePendingError(
              operation.operationId,
              persisted?.stage ?? operation.stage,
            );
          }
          const aborted =
            (await this.operations.findById(operation.operationId)) ??
            operation;
          await this.finalize(aborted, 'ABORT', actor);
          throw error;
        }
      }
      let result: { readonly value: T } | { readonly error: unknown };
      try {
        result = await this.unitOfWork.run(async (context) => {
          try {
            const value = await input.change(context, operation, actor);
            await this.operations.recordOutcome(
              {
                operationId: operation.operationId,
                outcome: 'COMMIT',
                now: this.now(),
              },
              context,
            );
            return { value };
          } catch (error) {
            if (!input.isBusinessFailure(error)) throw error;
            await input.recordAbort(
              context,
              operation,
              actor,
              safeErrorCode(error),
            );
            await this.operations.recordOutcome(
              {
                operationId: operation.operationId,
                outcome: 'ABORT',
                safeError: safeErrorCode(error),
                now: this.now(),
              },
              context,
            );
            return { error };
          }
        });
      } catch (error) {
        if (error instanceof NodeLifecyclePendingError) throw error;
        const persisted = await this.operations.findById(operation.operationId);
        if (
          persisted?.stage === 'COMMIT_PENDING_GATE_FINALIZE' ||
          persisted?.stage === 'ABORT_PENDING_GATE_RESTORE'
        ) {
          await this.finalize(persisted, persisted.outcome!, actor);
          if (persisted.outcome === 'COMMIT') return;
          throw new NodeLifecyclePendingError(
            operation.operationId,
            'COMPLETE',
          );
        }
        await this.recordFailure(operation.operationId, safeErrorCode(error));
        // The Core transaction outcome is unknown. Leave Fleet closed and let
        // the durable GATE_CLOSED journal determine the next retry.
        throw new NodeLifecyclePendingError(
          operation.operationId,
          persisted?.stage ?? operation.stage,
        );
      }
      operation =
        (await this.operations.findById(operation.operationId)) ?? operation;
      if ('error' in result) {
        await this.finalize(operation, 'ABORT', actor);
        throw result.error;
      }
      await this.finalize(operation, 'COMMIT', actor);
      return result.value;
    }

    if (operation.stage === 'COMMIT_PENDING_GATE_FINALIZE') {
      await this.finalize(operation, 'COMMIT', actor);
      return;
    }
    if (operation.stage === 'ABORT_PENDING_GATE_RESTORE') {
      await this.finalize(operation, 'ABORT', actor);
      return;
    }
    throw new NodeLifecycleOperationUnavailableError();
  }

  private async finalize(
    operation: NodeLifecycleOperation,
    outcome: 'COMMIT' | 'ABORT',
    actor: AssetActor,
  ): Promise<void> {
    if (!operation.gate) throw new NodeLifecycleOperationUnavailableError();
    try {
      await this.fleet.completeEnrollmentGate({
        gate: operation.gate,
        outcome,
        actor: {
          actorId: actor.id,
          requestId: actor.context?.request_id ?? operation.operationId,
        },
      });
      await this.operations.markComplete(operation.operationId, this.now());
    } catch {
      await this.recordFailure(
        operation.operationId,
        'FLEET_GATE_FINALIZE_UNAVAILABLE',
      );
      throw new NodeLifecyclePendingError(
        operation.operationId,
        operation.stage,
      );
    }
  }

  private async recordFailure(
    operationId: string,
    safeCode: string,
  ): Promise<void> {
    try {
      await this.operations.recordFailure(operationId, safeCode, this.now());
    } catch {
      // The original durable stage remains safe and visible even if its
      // supplemental operator error marker cannot be written.
    }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
function safeErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return error.code.slice(0, 80);
  return 'NODE_LIFECYCLE_REJECTED';
}
