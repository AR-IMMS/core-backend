import type { UnitOfWorkContext } from '@platform/events';
import type { AssetActor } from '../assets/asset-registration.use-case';
import type { AgentNodeEnrollmentGate } from '@modules/agent-management/contracts';

export type NodeLifecycleAction = 'RETIRE' | 'UNMAP';
export type NodeLifecycleStage =
  | 'GATE_CLOSE_PENDING'
  | 'CORE_CHANGE_PENDING'
  | 'COMMIT_PENDING_GATE_FINALIZE'
  | 'ABORT_PENDING_GATE_RESTORE'
  | 'COMPLETE';
export type NodeLifecycleOutcome = 'COMMIT' | 'ABORT';

export interface NodeLifecycleOperation {
  readonly operationId: string;
  readonly nodeId: string;
  readonly action: NodeLifecycleAction;
  readonly actorId: string;
  readonly idempotencyHash: string | null;
  readonly fingerprint: string;
  readonly stage: NodeLifecycleStage;
  readonly gate?: AgentNodeEnrollmentGate;
  readonly outcome?: NodeLifecycleOutcome;
  readonly safeError?: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface NodeLifecycleOperationPort {
  begin(input: {
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
  }>;
  findById(operationId: string): Promise<NodeLifecycleOperation | null>;
  findPending(input: {
    readonly nodeId?: string;
    readonly limit: number;
  }): Promise<readonly NodeLifecycleOperation[]>;
  recordGate(
    operationId: string,
    gate: AgentNodeEnrollmentGate,
    now: Date,
  ): Promise<void>;
  recordFailure(
    operationId: string,
    safeError: string,
    now: Date,
  ): Promise<void>;
  recordOutcome(
    input: {
      readonly operationId: string;
      readonly outcome: NodeLifecycleOutcome;
      readonly safeError?: string;
      readonly now: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<void>;
  markComplete(operationId: string, now: Date): Promise<void>;
}

export const NODE_LIFECYCLE_OPERATION_PORT = Symbol(
  'NODE_LIFECYCLE_OPERATION_PORT',
);
