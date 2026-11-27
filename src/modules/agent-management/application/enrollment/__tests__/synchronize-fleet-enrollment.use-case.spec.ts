import {
  FleetConflictError,
  FleetProtocolError,
} from '../../ports/fleet/fleet-errors';
import { FleetOperationPendingError } from '../errors/fleet-operation-pending.error';
import { SynchronizeFleetEnrollmentUseCase } from '../synchronize-fleet-enrollment.use-case';
import type { OutboxWriterPort, UnitOfWorkPort } from '@platform/events';

describe('SynchronizeFleetEnrollmentUseCase', () => {
  const actor = { actorId: 'sync-user', requestId: 'sync-request' };
  const operation = {
    operationId: 'operation-1',
    idempotencyHash: 'key-hash',
    fingerprint: 'request-fingerprint',
    actorId: 'creator-user',
    nodeId: 'node-1',
    status: 'INVITATION_ISSUED',
    invitationId: 'invitation-1',
  };
  const operations = {
    findByIdempotencyHash: jest.fn(),
    findByInvitationId: jest.fn().mockResolvedValue(operation),
    begin: jest.fn(),
    recordInvitation: jest.fn().mockResolvedValue(undefined),
    markBound: jest.fn().mockResolvedValue(undefined),
  };
  const invitations = {
    create: jest.fn(),
    getByOperation: jest.fn().mockResolvedValue({
      invitationId: 'invitation-1',
      operationId: 'operation-1',
      nodeId: 'node-1',
      status: 'REDEEMED',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      installationId: 'agent-1',
    }),
    cancel: jest.fn(),
  };
  const installations = {
    findActiveByNode: jest.fn(),
    findById: jest.fn().mockResolvedValue({
      installationId: 'agent-1',
      nodeId: 'node-1',
      status: 'ACTIVE',
    }),
    closeEnrollmentGate: jest.fn(),
    completeEnrollmentGate: jest.fn(),
    revoke: jest.fn(),
  };
  const node = {
    getEligibility: jest.fn().mockResolvedValue({
      exists: true,
      active: true,
      hasActivePlacement: true,
    }),
    serializeEnrollmentEligibility: jest.fn().mockResolvedValue(true),
  };
  const bindings = {
    hasActiveForNode: jest.fn().mockResolvedValue(false),
    upsert: jest.fn().mockResolvedValue('CREATED'),
  };
  const testContext = {};
  const unitOfWork = {
    run: jest.fn((work: (context: object) => Promise<unknown>) =>
      work(testContext),
    ),
  };
  const auditFacts: { payload: { actor: { type: string; id: string } } }[] = [];
  const outbox = {
    append: jest.fn((fact: (typeof auditFacts)[number]) => {
      auditFacts.push(fact);
      return Promise.resolve();
    }),
  };
  let useCase: SynchronizeFleetEnrollmentUseCase;

  beforeEach(() => {
    jest.clearAllMocks();
    auditFacts.length = 0;
    operations.findByInvitationId.mockResolvedValue(operation);
    operations.recordInvitation.mockResolvedValue(undefined);
    operations.markBound.mockResolvedValue(undefined);
    invitations.getByOperation.mockResolvedValue({
      invitationId: 'invitation-1',
      operationId: 'operation-1',
      nodeId: 'node-1',
      status: 'REDEEMED',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      installationId: 'agent-1',
    });
    installations.findById.mockResolvedValue({
      installationId: 'agent-1',
      nodeId: 'node-1',
      status: 'ACTIVE',
    });
    node.getEligibility.mockResolvedValue({
      exists: true,
      active: true,
      hasActivePlacement: true,
    });
    bindings.upsert.mockResolvedValue('CREATED');
    useCase = new SynchronizeFleetEnrollmentUseCase(
      operations,
      invitations,
      installations,
      node,
      bindings,
      unitOfWork as unknown as UnitOfWorkPort,
      outbox as unknown as OutboxWriterPort,
      () => new Date('2026-11-22T00:00:00Z'),
    );
  });

  test('creates a Core binding only after Fleet confirms an active redeemed installation', async () => {
    await expect(
      useCase.execute({ invitationId: 'invitation-1', actor }),
    ).resolves.toMatchObject({ status: 'BOUND', installationId: 'agent-1' });
    expect(bindings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        invitationId: 'invitation-1',
        installationId: 'agent-1',
        nodeId: 'node-1',
      }),
      testContext,
    );
    expect(operations.markBound).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: 'operation-1' }),
      testContext,
    );
    expect(auditFacts).toHaveLength(1);
    expect(auditFacts[0].payload.actor).toEqual({
      type: 'user',
      id: actor.actorId,
    });
  });

  test('returns pending without creating a binding before Fleet redemption', async () => {
    invitations.getByOperation.mockResolvedValue({
      invitationId: 'invitation-1',
      operationId: 'operation-1',
      nodeId: 'node-1',
      status: 'PENDING',
      expiresAt: new Date('2026-11-22T01:00:00Z'),
      invitationToken: 'should-not-be-returned-by-sync',
    });

    await expect(
      useCase.execute({ invitationId: 'invitation-1', actor }),
    ).resolves.toMatchObject({ status: 'PENDING' });
    expect(bindings.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(outbox.append.mock.calls)).not.toContain(
      'should-not-be-returned-by-sync',
    );
  });

  test('records redeemed as sync pending before local binding and can retry after Core failure', async () => {
    bindings.upsert.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      useCase.execute({ invitationId: 'invitation-1', actor }),
    ).rejects.toBeInstanceOf(FleetOperationPendingError);
    expect(operations.recordInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'REDEEMED' }),
      testContext,
    );
    expect(operations.markBound).not.toHaveBeenCalled();
    expect(auditFacts).toHaveLength(0);
  });

  test('does not reactivate a previously revoked Core binding', async () => {
    bindings.upsert.mockResolvedValue('REVOKED');

    await expect(
      useCase.execute({ invitationId: 'invitation-1', actor }),
    ).rejects.toBeInstanceOf(FleetConflictError);
    expect(operations.markBound).not.toHaveBeenCalled();
    expect(auditFacts).toHaveLength(0);
  });

  test('rejects a Fleet installation whose Node does not match the invitation', async () => {
    installations.findById.mockResolvedValue({
      installationId: 'agent-1',
      nodeId: 'another-node',
      status: 'ACTIVE',
    });

    await expect(
      useCase.execute({ invitationId: 'invitation-1', actor }),
    ).rejects.toBeInstanceOf(FleetProtocolError);
    expect(bindings.upsert).not.toHaveBeenCalled();
  });

  test('does not duplicate the binding audit on a retry after successful sync', async () => {
    bindings.upsert.mockResolvedValue('EXISTS');

    await expect(
      useCase.execute({ invitationId: 'invitation-1', actor }),
    ).resolves.toMatchObject({ status: 'BOUND' });
    expect(auditFacts).toHaveLength(0);
  });
});
