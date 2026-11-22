import { NodeLifecycleOperationController } from '../node-lifecycle-operation.controller';

describe('NodeLifecycleOperationController', () => {
  const operation = {
    operationId: 'operation-1',
    nodeId: 'node-1',
    action: 'UNMAP' as const,
    actorId: 'admin-1',
    idempotencyHash: null,
    fingerprint: 'fingerprint',
    stage: 'COMMIT_PENDING_GATE_FINALIZE' as const,
    gate: {
      nodeId: 'node-1',
      operationId: 'operation-1',
      version: 3,
      previousState: 'OPEN' as const,
      activeBinding: null,
    },
    outcome: 'COMMIT' as const,
    safeError: undefined,
    createdAt: new Date('2026-11-22T10:00:00Z'),
    updatedAt: new Date('2026-11-22T10:01:00Z'),
  };
  const request = {
    user: { userId: 'admin-1', role: 'IT_ADMIN' as const },
    requestId: 'request-1',
  };
  const operations = {
    findById: jest.fn().mockResolvedValue(operation),
    findPending: jest.fn().mockResolvedValue([operation]),
  };
  const retire = { execute: jest.fn().mockResolvedValue(undefined) };
  const placement = { unmap: jest.fn().mockResolvedValue(undefined) };
  const controller = new NodeLifecycleOperationController(
    operations as never,
    retire as never,
    placement as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('lists only safe pending operation fields', async () => {
    await expect(controller.list(request, 20)).resolves.toEqual({
      items: [
        {
          operation_id: 'operation-1',
          node_id: 'node-1',
          action: 'UNMAP',
          stage: 'COMMIT_PENDING_GATE_FINALIZE',
          created_at: operation.createdAt.toISOString(),
          updated_at: operation.updatedAt.toISOString(),
        },
      ],
    });
    expect(operations.findPending).toHaveBeenCalledWith({ limit: 20 });
  });

  it('retries the same persisted operation ID under the verified operator principal', async () => {
    await controller.retry(request, 'operation-1');
    expect(placement.unmap).toHaveBeenCalledWith(
      'node-1',
      { type: 'user', id: 'admin-1', context: { request_id: 'request-1' } },
      { operationId: 'operation-1' },
    );
    expect(retire.execute).not.toHaveBeenCalled();
  });
});
