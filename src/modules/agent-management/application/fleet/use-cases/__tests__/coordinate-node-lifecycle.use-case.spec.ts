import { CoordinateNodeLifecycleUseCase } from '../coordinate-node-lifecycle.use-case';

describe('CoordinateNodeLifecycleUseCase', () => {
  const gate = {
    nodeId: 'node-1',
    operationId: 'operation-1',
    version: 7,
    previousState: 'CLOSED' as const,
  };
  const actor = { actorId: 'human-1', requestId: 'request-1' };
  const installations = {
    closeEnrollmentGate: jest.fn(),
    completeEnrollmentGate: jest.fn().mockResolvedValue(undefined),
  };
  const useCase = new CoordinateNodeLifecycleUseCase(installations as never);

  beforeEach(() => jest.clearAllMocks());

  it('restores the exact prior state on abort using the gate owner and version', async () => {
    await useCase.completeEnrollmentGate({ gate, outcome: 'ABORT', actor });
    expect(installations.completeEnrollmentGate).toHaveBeenCalledWith({
      gate,
      state: 'CLOSED',
      actor,
    });
  });

  it('leaves a committed lifecycle gate closed', async () => {
    await useCase.completeEnrollmentGate({ gate, outcome: 'COMMIT', actor });
    expect(installations.completeEnrollmentGate).toHaveBeenCalledWith({
      gate,
      state: 'CLOSED',
      actor,
    });
  });

  it('restores OPEN only when OPEN was the recorded prior state', async () => {
    await useCase.completeEnrollmentGate({
      gate: { ...gate, previousState: 'OPEN' },
      outcome: 'ABORT',
      actor,
    });
    expect(installations.completeEnrollmentGate).toHaveBeenCalledWith({
      gate: { ...gate, previousState: 'OPEN' },
      state: 'OPEN',
      actor,
    });
  });
});
