import { createHash } from 'node:crypto';
import { FleetConflictError } from '../../ports/fleet/fleet-errors';
import { FleetUnavailableError } from '../../ports/fleet/fleet-errors';
import { FleetOperationPendingError } from '../errors/fleet-operation-pending.error';
import { RequestFleetInvitationUseCase } from '../request-fleet-invitation.use-case';
import { AgentNodeNotEligibleError } from '../errors/node-eligibility.errors';
import type { EnrollmentOperationPort } from '.././enrollment-operation.port';
import type {
  OutboxWriterPort,
  UnitOfWorkContext,
  UnitOfWorkPort,
} from '@platform/events';

describe('RequestFleetInvitationUseCase', () => {
  const actor = { actorId: 'user-1', requestId: 'request-1' };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        action: 'create-invitation',
        actorId: 'user-1',
        nodeId: 'node-1',
        ttl: 600,
      }),
    )
    .digest('hex');
  const eligibleNode = {
    getEligibility: jest.fn().mockResolvedValue({
      exists: true,
      active: true,
      hasActivePlacement: true,
    }),
    serializeEnrollmentEligibility: jest.fn().mockResolvedValue(true),
  };
  const fleetBindings = {
    hasActiveForNode: jest.fn().mockResolvedValue(false),
    upsert: jest.fn(),
  };
  const fleetInstallations = {
    findById: jest.fn(),
    findActiveByNode: jest.fn().mockResolvedValue(null),
    closeEnrollmentGate: jest.fn(),
    completeEnrollmentGate: jest.fn(),
    revoke: jest.fn(),
  };
  const fleetInvitations = {
    create: jest.fn().mockResolvedValue({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'PENDING',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      invitationToken: 'do-not-store-this-secret',
    }),
    getByOperation: jest.fn().mockResolvedValue(null),
    cancel: jest.fn(),
  };
  const operations = {
    findByIdempotencyHash: jest.fn().mockResolvedValue(null),
    findByInvitationId: jest.fn().mockResolvedValue(null),
    begin: jest.fn(),
    recordInvitation: jest.fn().mockResolvedValue(true),
    markBound: jest.fn().mockResolvedValue(undefined),
  };
  const testContext = {} as UnitOfWorkContext;
  const unitOfWork = {
    run: jest.fn((work: (context: UnitOfWorkContext) => Promise<unknown>) =>
      work(testContext),
    ),
  };
  const auditFacts: {
    payload: { actor: { type: string; id: string } };
  }[] = [];
  const outbox = {
    append: jest.fn((fact: (typeof auditFacts)[number]) => {
      auditFacts.push(fact);
      return Promise.resolve();
    }),
  };
  let useCase: RequestFleetInvitationUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    auditFacts.length = 0;
    eligibleNode.getEligibility.mockResolvedValue({
      exists: true,
      active: true,
      hasActivePlacement: true,
    });
    fleetBindings.hasActiveForNode.mockResolvedValue(false);
    fleetInstallations.findActiveByNode.mockResolvedValue(null);
    operations.findByIdempotencyHash.mockResolvedValue(null);
    operations.begin.mockImplementation(
      (input: Parameters<EnrollmentOperationPort['begin']>[0]) =>
        Promise.resolve({
          created: true,
          operation: { ...input, status: 'REQUEST_PENDING' },
        }),
    );
    fleetInvitations.create.mockResolvedValue({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'PENDING',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      invitationToken: 'do-not-store-this-secret',
    });
    useCase = new RequestFleetInvitationUseCase(
      eligibleNode,
      fleetBindings,
      fleetInstallations,
      fleetInvitations,
      operations,
      unitOfWork as unknown as UnitOfWorkPort,
      outbox as unknown as OutboxWriterPort,
      () => new Date('2026-11-22T00:00:00Z'),
      () => 'op-1',
    );
  });

  test('checks current Node eligibility and both binding authorities before create', async () => {
    const result = await useCase.execute({
      nodeId: 'node-1',
      idempotencyKey: 'client-key-12345678',
      actor,
    });

    expect(result).toMatchObject({
      status: 'PENDING',
      invitationToken: 'do-not-store-this-secret',
    });
    expect(fleetInstallations.findActiveByNode).toHaveBeenCalledWith({
      nodeId: 'node-1',
      actor,
    });
    expect(fleetBindings.hasActiveForNode).toHaveBeenCalledWith('node-1');
    expect(fleetInvitations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: 'op-1',
        idempotencyKey: 'op-1',
        nodeId: 'node-1',
        actor,
      }),
    );
    expect(operations.recordInvitation).toHaveBeenCalled();
    const recordedAudit = auditFacts[0];
    expect(recordedAudit.payload.actor).toEqual({
      type: 'user',
      id: 'user-1',
    });
    expect(JSON.stringify(recordedAudit)).not.toContain(
      'do-not-store-this-secret',
    );
  });

  test('rejects an unplaced Node without creating an operation in Fleet', async () => {
    eligibleNode.getEligibility.mockResolvedValue({
      exists: true,
      active: true,
      hasActivePlacement: false,
    });

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).rejects.toBeInstanceOf(AgentNodeNotEligibleError);
    expect(fleetInvitations.create).not.toHaveBeenCalled();
    expect(operations.begin).not.toHaveBeenCalled();
  });

  test('does not create a second Fleet invitation when local binding already exists', async () => {
    fleetBindings.hasActiveForNode.mockResolvedValue(true);

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).rejects.toBeInstanceOf(AgentNodeNotEligibleError);
    expect(fleetInvitations.create).not.toHaveBeenCalled();
  });

  test('recovers a pending invitation secret by replaying the same Fleet create operation', async () => {
    operations.findByIdempotencyHash.mockResolvedValue({
      operationId: 'op-1',
      actorId: 'user-1',
      nodeId: 'node-1',
      fingerprint,
      status: 'INVITATION_ISSUED',
      invitationId: 'invite-1',
    });
    fleetInvitations.getByOperation.mockResolvedValue({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'PENDING',
    });
    fleetInvitations.create.mockResolvedValue({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'PENDING',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      invitationToken: 'same-pending-secret',
    });

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).resolves.toMatchObject({
      status: 'PENDING',
      invitationId: 'invite-1',
      invitationToken: 'same-pending-secret',
    });
    expect(fleetInvitations.create).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'node-1',
        operationId: 'op-1',
        idempotencyKey: 'op-1',
        requestedTtlSeconds: 600,
      }),
    );
  });
  test('re-reads status if a pending invitation is exchanged during secret recovery', async () => {
    operations.findByIdempotencyHash.mockResolvedValue({
      operationId: 'op-1',
      actorId: 'user-1',
      nodeId: 'node-1',
      fingerprint,
      status: 'INVITATION_ISSUED',
      invitationId: 'invite-1',
    });
    fleetInvitations.getByOperation
      .mockResolvedValueOnce({
        invitationId: 'invite-1',
        operationId: 'op-1',
        nodeId: 'node-1',
        status: 'PENDING',
      })
      .mockResolvedValueOnce({
        invitationId: 'invite-1',
        operationId: 'op-1',
        nodeId: 'node-1',
        status: 'REDEEMED',
        installationId: 'install-1',
      });
    fleetInvitations.create.mockRejectedValueOnce(
      new FleetConflictError('CONFLICT'),
    );

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).resolves.toMatchObject({
      status: 'REDEEMED',
      installationId: 'install-1',
    });
    expect(fleetInvitations.getByOperation).toHaveBeenCalledTimes(2);
  });
  test('returns operation state and no secret after redemption', async () => {
    operations.findByIdempotencyHash.mockResolvedValue({
      operationId: 'op-1',
      actorId: 'user-1',
      nodeId: 'node-1',
      fingerprint,
      status: 'INVITATION_ISSUED',
      invitationId: 'invite-1',
    });
    fleetInvitations.getByOperation.mockResolvedValue({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'REDEEMED',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      installationId: 'install-1',
    });

    const result = await useCase.execute({
      nodeId: 'node-1',
      idempotencyKey: 'client-key-12345678',
      actor,
    });
    expect(result).toMatchObject({
      status: 'REDEEMED',
      invitationId: 'invite-1',
    });
    expect(result).not.toHaveProperty('invitationToken');
    expect(fleetInvitations.create).not.toHaveBeenCalled();
  });

  test('replays a locally terminal invitation as status-only without trusting a stale Fleet read', async () => {
    operations.findByIdempotencyHash.mockResolvedValue({
      operationId: 'op-1',
      actorId: 'user-1',
      nodeId: 'node-1',
      fingerprint,
      status: 'CANCELLED',
      invitationId: 'invite-1',
    });

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).resolves.toMatchObject({ status: 'CANCELLED', invitationId: 'invite-1' });
    expect(fleetInvitations.getByOperation).not.toHaveBeenCalled();
    expect(fleetInvitations.create).not.toHaveBeenCalled();
  });

  test('conflicts when the same client key has a changed actor or payload', async () => {
    operations.findByIdempotencyHash.mockResolvedValue({
      operationId: 'op-1',
      actorId: 'other-user',
      nodeId: 'node-1',
      fingerprint: 'different',
      status: 'REQUEST_PENDING',
    });

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).rejects.toBeInstanceOf(FleetConflictError);
    expect(fleetInvitations.getByOperation).not.toHaveBeenCalled();
  });

  test('replays the same Fleet operation after an unknown create result', async () => {
    operations.findByIdempotencyHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        operationId: 'op-1',
        actorId: 'user-1',
        nodeId: 'node-1',
        fingerprint,
        status: 'REQUEST_PENDING',
      });
    fleetInvitations.create.mockRejectedValueOnce(
      new FleetUnavailableError(true),
    );
    fleetInvitations.getByOperation.mockResolvedValue({
      invitationId: 'invite-1',
      operationId: 'op-1',
      nodeId: 'node-1',
      status: 'PENDING',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      invitationToken: 'do-not-store-this-secret',
    });

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).rejects.toBeInstanceOf(FleetOperationPendingError);
    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).resolves.toMatchObject({ operationId: 'op-1', status: 'PENDING' });
    expect(fleetInvitations.create).toHaveBeenCalledTimes(1);
    expect(operations.begin).toHaveBeenCalledTimes(1);
  });

  test('retries a known-not-sent invitation after a confirmed Fleet miss', async () => {
    const pendingOperation = {
      operationId: 'op-1',
      actorId: 'user-1',
      nodeId: 'node-1',
      fingerprint,
      status: 'REQUEST_PENDING' as const,
    };
    operations.findByIdempotencyHash
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(pendingOperation);
    fleetInvitations.create
      .mockRejectedValueOnce(new FleetUnavailableError(false))
      .mockResolvedValueOnce({
        invitationId: 'invite-1',
        operationId: 'op-1',
        nodeId: 'node-1',
        status: 'PENDING',
        expiresAt: new Date('2026-11-22T01:00:00Z'),
        invitationToken: 'do-not-store-this-secret',
      });
    fleetInvitations.getByOperation.mockResolvedValueOnce(null);

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).rejects.toBeInstanceOf(FleetUnavailableError);

    await expect(
      useCase.execute({
        nodeId: 'node-1',
        idempotencyKey: 'client-key-12345678',
        actor,
      }),
    ).resolves.toMatchObject({ status: 'PENDING', operationId: 'op-1' });
    expect(fleetInvitations.create).toHaveBeenCalledTimes(2);
    expect(fleetInvitations.create).toHaveBeenLastCalledWith(
      expect.objectContaining({
        operationId: 'op-1',
        idempotencyKey: 'op-1',
      }),
    );
  });
});
