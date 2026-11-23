import {
  NodeLifecycleOrchestrator,
  NodeLifecyclePendingError,
} from '../node-lifecycle-orchestrator';
import type {
  NodeLifecycleOperation,
  NodeLifecycleOperationPort,
} from '../node-lifecycle-operation.port';
import type {
  AgentNodeLifecycleCoordination,
  AgentNodeEnrollmentGate,
} from '@modules/agent-management/contracts';
import type { UnitOfWorkContext, UnitOfWorkPort } from '@platform/events';

const actor = { type: 'user', id: 'admin-1', context: { request_id: 'req-1' } };
const gate: AgentNodeEnrollmentGate = {
  nodeId: 'node-1',
  operationId: 'operation-1',
  version: 4,
  previousState: 'CLOSED',
  activeBinding: null,
};
const now = new Date('2026-11-22T12:00:00Z');

class MemoryJournal implements NodeLifecycleOperationPort {
  row: NodeLifecycleOperation | null = null;
  outcomeContext?: UnitOfWorkContext;
  begin(input: Parameters<NodeLifecycleOperationPort['begin']>[0]) {
    if (!this.row)
      this.row = {
        operationId: input.operationId,
        nodeId: input.nodeId,
        action: input.action,
        actorId: input.actor.id,
        idempotencyHash: input.idempotencyHash,
        fingerprint: input.fingerprint,
        stage: 'GATE_CLOSE_PENDING',
        createdAt: input.now,
        updatedAt: input.now,
      };
    return Promise.resolve({
      created: this.row.operationId === input.operationId,
      operation: this.row,
    });
  }
  findById(): Promise<NodeLifecycleOperation | null> {
    return Promise.resolve(this.row);
  }
  findPending(): Promise<readonly NodeLifecycleOperation[]> {
    return Promise.resolve(
      this.row?.stage === 'COMPLETE' || !this.row ? [] : [this.row],
    );
  }
  recordGate(_id: string, value: AgentNodeEnrollmentGate): Promise<void> {
    this.row = { ...this.row!, gate: value, stage: 'CORE_CHANGE_PENDING' };
    return Promise.resolve();
  }
  recordFailure(_id: string, safeError: string): Promise<void> {
    this.row = { ...this.row!, safeError };
    return Promise.resolve();
  }
  recordOutcome(
    input: Parameters<NodeLifecycleOperationPort['recordOutcome']>[0],
    context: UnitOfWorkContext,
  ): Promise<void> {
    this.outcomeContext = context;
    this.row = {
      ...this.row!,
      outcome: input.outcome,
      stage:
        input.outcome === 'COMMIT'
          ? 'COMMIT_PENDING_GATE_FINALIZE'
          : 'ABORT_PENDING_GATE_RESTORE',
      ...(input.safeError ? { safeError: input.safeError } : {}),
    };
    return Promise.resolve();
  }
  markComplete(): Promise<void> {
    this.row = { ...this.row!, stage: 'COMPLETE' };
    return Promise.resolve();
  }
}

class FakeUnitOfWork implements UnitOfWorkPort {
  failBeforeCallback = false;
  loseCommitAcknowledgment = false;
  async run<T>(work: (context: UnitOfWorkContext) => Promise<T>): Promise<T> {
    if (this.failBeforeCallback) {
      this.failBeforeCallback = false;
      throw new Error('transaction outcome unknown');
    }
    const result = await work({} as UnitOfWorkContext);
    if (this.loseCommitAcknowledgment) {
      this.loseCommitAcknowledgment = false;
      throw new Error('commit acknowledgment lost');
    }
    return result;
  }
}

class FakeFleet implements AgentNodeLifecycleCoordination {
  readonly closeCalls: string[] = [];
  readonly completeCalls: Array<{
    gate: AgentNodeEnrollmentGate;
    outcome: 'COMMIT' | 'ABORT';
  }> = [];
  failClose = false;
  failComplete = 0;
  closeEnrollmentGate(input: {
    readonly nodeId: string;
    readonly operationId: string;
  }): Promise<AgentNodeEnrollmentGate> {
    this.closeCalls.push(input.operationId);
    if (this.failClose) {
      this.failClose = false;
      return Promise.reject(new Error('Fleet timeout'));
    }
    return Promise.resolve({
      ...gate,
      nodeId: input.nodeId,
      operationId: input.operationId,
    });
  }
  completeEnrollmentGate(input: {
    readonly gate: AgentNodeEnrollmentGate;
    readonly outcome: 'COMMIT' | 'ABORT';
  }): Promise<void> {
    this.completeCalls.push({ gate: input.gate, outcome: input.outcome });
    if (this.failComplete > 0) {
      this.failComplete -= 1;
      return Promise.reject(new Error('Fleet unavailable'));
    }
    return Promise.resolve();
  }
}

describe('NodeLifecycleOrchestrator', () => {
  let journal: MemoryJournal;
  let fleet: FakeFleet;
  let unitOfWork: FakeUnitOfWork;
  let orchestration: NodeLifecycleOrchestrator;

  beforeEach(() => {
    journal = new MemoryJournal();
    fleet = new FakeFleet();
    unitOfWork = new FakeUnitOfWork();
    orchestration = new NodeLifecycleOrchestrator(
      journal,
      fleet,
      unitOfWork,
      () => now,
      () => 'operation-1',
    );
  });

  function request(
    change: () => Promise<void>,
    operationId?: string,
    beforeChange?: Parameters<
      NodeLifecycleOrchestrator['execute']
    >[0]['beforeChange'],
  ) {
    return orchestration.execute({
      nodeId: 'node-1',
      action: 'UNMAP',
      actor,
      ...(operationId ? { operationId } : {}),
      ...(beforeChange ? { beforeChange } : {}),
      change: async () => change(),
      isBusinessFailure: (error) =>
        error instanceof Error && error.message === 'rule rejected',
      recordAbort: () => Promise.resolve(),
    });
  }

  it('commits Node work and durable outcome before finalizing the gate', async () => {
    const change = jest.fn().mockResolvedValue(undefined);
    await request(change);
    expect(fleet.closeCalls).toEqual(['operation-1']);
    expect(journal.row?.outcome).toBe('COMMIT');
    expect(journal.outcomeContext).toBeDefined();
    expect(fleet.completeCalls).toEqual([{ gate, outcome: 'COMMIT' }]);
    expect(journal.row?.stage).toBe('COMPLETE');
  });

  it('restores the previously closed gate after a known business abort', async () => {
    const change = jest.fn().mockRejectedValue(new Error('rule rejected'));
    await expect(request(change)).rejects.toThrow('rule rejected');
    expect(journal.row?.outcome).toBe('ABORT');
    expect(fleet.completeCalls).toEqual([{ gate, outcome: 'ABORT' }]);
    expect(journal.row?.stage).toBe('COMPLETE');
  });

  it('keeps the gate closed after an uncommitted transaction error and retries the same operation', async () => {
    unitOfWork.failBeforeCallback = true;
    const change = jest.fn().mockResolvedValue(undefined);
    await expect(request(change)).rejects.toBeInstanceOf(
      NodeLifecyclePendingError,
    );
    expect(journal.row?.stage).toBe('CORE_CHANGE_PENDING');
    expect(fleet.completeCalls).toHaveLength(0);
    await request(change, 'operation-1');
    expect(fleet.closeCalls).toHaveLength(1);
    expect(change).toHaveBeenCalledTimes(1);
    expect(journal.row?.stage).toBe('COMPLETE');
  });

  it('does not repeat Core mutation after commit when Fleet gate completion failed', async () => {
    fleet.failComplete = 1;
    const change = jest.fn().mockResolvedValue(undefined);
    await expect(request(change)).rejects.toBeInstanceOf(
      NodeLifecyclePendingError,
    );
    expect(journal.row?.stage).toBe('COMMIT_PENDING_GATE_FINALIZE');
    await request(change, 'operation-1');
    expect(change).toHaveBeenCalledTimes(1);
    expect(fleet.completeCalls).toHaveLength(2);
    expect(journal.row?.stage).toBe('COMPLETE');
  });

  it('uses the durable committed outcome when the transaction response is lost', async () => {
    unitOfWork.loseCommitAcknowledgment = true;
    const change = jest.fn().mockResolvedValue(undefined);
    await request(change);
    expect(change).toHaveBeenCalledTimes(1);
    expect(fleet.completeCalls).toEqual([{ gate, outcome: 'COMMIT' }]);
    expect(journal.row?.stage).toBe('COMPLETE');
  });

  it('recovers a lost acknowledgment for an atomic business-abort audit and outcome', async () => {
    unitOfWork.loseCommitAcknowledgment = true;
    const rejected = new Error('rule rejected');
    await expect(
      request(jest.fn().mockResolvedValue(undefined), undefined, () => {
        throw rejected;
      }),
    ).rejects.toBe(rejected);
    expect(journal.row?.stage).toBe('COMPLETE');
    expect(journal.row?.outcome).toBe('ABORT');
    expect(fleet.completeCalls).toEqual([{ gate, outcome: 'ABORT' }]);
  });

  it('keeps a closed gate visible if close has an unknown response', async () => {
    fleet.failClose = true;
    const change = jest.fn().mockResolvedValue(undefined);
    await expect(request(change)).rejects.toBeInstanceOf(
      NodeLifecyclePendingError,
    );
    expect(journal.row?.stage).toBe('GATE_CLOSE_PENDING');
    expect(change).not.toHaveBeenCalled();
  });
});
