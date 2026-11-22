import type {
  AuditFactV2,
  OutboxWriterPort,
  UnitOfWorkContext,
} from '@platform/events';
import { RequestFleetInvitationUseCase } from '../use-cases/request-fleet-invitation.use-case';
import { SynchronizeFleetEnrollmentUseCase } from '../use-cases/synchronize-fleet-enrollment.use-case';
import type { FleetEnrollmentOperation } from '../ports/fleet-enrollment-operation.port';

/**
 * A contract-shaped fake: it exercises Core orchestration and state transitions
 * without asserting that the provisional HTTP wire format works with Fleet.
 */
describe('Core Fleet enrollment boundary (fake Fleet)', () => {
  const actor = { actorId: 'human-1', requestId: 'request-1' };
  const fleetState = {
    status: 'PENDING' as 'PENDING' | 'REDEEMED',
    invitationId: 'invitation-1',
    installationId: 'installation-1',
    nodeId: 'node-1',
    operationId: 'operation-1',
    token: 'secret-only-while-pending',
    expiresAt: new Date('2026-11-23T00:00:00Z'),
  };
  const operationByKey = new Map<string, FleetEnrollmentOperation>();
  const operationByInvitation = new Map<string, FleetEnrollmentOperation>();
  const bindings = new Map<string, string>();
  const auditFacts: AuditFactV2[] = [];
  const context = {} as UnitOfWorkContext;
  const unitOfWork = {
    run: async <T>(work: (ctx: UnitOfWorkContext) => Promise<T>) =>
      work(context),
  };
  const outbox = {
    append: (fact: AuditFactV2) => {
      auditFacts.push(fact);
      return Promise.resolve();
    },
  };
  const nodePort = {
    getEligibility: () =>
      Promise.resolve({
        exists: true,
        active: true,
        hasActivePlacement: true,
      }),
    serializeEnrollmentEligibility: () => Promise.resolve(true),
  };
  const coreBindings = { hasActiveBinding: () => Promise.resolve(false) };
  const fakeFleet = {
    invitations: {
      create: (input: { operationId: string; nodeId: string }) =>
        Promise.resolve({
          invitationId: fleetState.invitationId,
          operationId: input.operationId,
          nodeId: input.nodeId,
          status: fleetState.status,
          expiresAt: fleetState.expiresAt,
          invitationToken: fleetState.token,
        }),
      getByOperation: () =>
        Promise.resolve({
          invitationId: fleetState.invitationId,
          operationId: fleetState.operationId,
          nodeId: fleetState.nodeId,
          status: fleetState.status,
          expiresAt: fleetState.expiresAt,
          ...(fleetState.status === 'PENDING'
            ? { invitationToken: fleetState.token }
            : { installationId: fleetState.installationId }),
        }),
      cancel: () => Promise.resolve(),
    },
    installations: {
      findActiveByNode: () => Promise.resolve(null),
      findById: () =>
        Promise.resolve({
          installationId: fleetState.installationId,
          nodeId: fleetState.nodeId,
          status: 'ACTIVE' as const,
        }),
      closeEnrollmentGate: () => Promise.reject(new Error('not in this slice')),
      completeEnrollmentGate: () =>
        Promise.reject(new Error('not in this slice')),
      revoke: () => Promise.reject(new Error('not in this slice')),
    },
  };
  const operations = {
    findByIdempotencyHash: (key: string) =>
      Promise.resolve(operationByKey.get(key) ?? null),
    findByInvitationId: (id: string) =>
      Promise.resolve(operationByInvitation.get(id) ?? null),
    begin: (input: {
      operationId: string;
      idempotencyHash: string;
      fingerprint: string;
      actorId: string;
      nodeId: string;
      createdAt: Date;
    }) => {
      const operation = { ...input, status: 'REQUEST_PENDING' as const };
      operationByKey.set(input.idempotencyHash, operation);
      return Promise.resolve({ created: true, operation });
    },
    recordInvitation: (input: {
      operationId: string;
      invitationId: string;
      status: 'PENDING' | 'REDEEMED' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';
      installationId?: string;
      expiresAt: Date;
      updatedAt: Date;
    }) => {
      const operation = [...operationByKey.values()].find(
        (candidate) => candidate.operationId === input.operationId,
      );
      if (!operation) throw new Error('operation missing');
      const firstRecording = !operation.invitationId;
      const updated = {
        ...operation,
        invitationId: input.invitationId,
        status:
          input.status === 'PENDING' ? 'INVITATION_ISSUED' : 'SYNC_PENDING',
        ...(input.installationId
          ? { installationId: input.installationId }
          : {}),
        expiresAt: input.expiresAt,
      } as FleetEnrollmentOperation;
      operationByKey.set(operation.idempotencyHash, updated);
      operationByInvitation.set(input.invitationId, updated);
      return Promise.resolve(firstRecording);
    },
    markBound: (input: { operationId: string; installationId: string }) => {
      const operation = [...operationByKey.values()].find(
        (candidate) => candidate.operationId === input.operationId,
      );
      if (!operation) throw new Error('operation missing');
      const updated = {
        ...operation,
        status: 'BOUND' as const,
        installationId: input.installationId,
      };
      operationByKey.set(operation.idempotencyHash, updated);
      if (operation.invitationId) {
        operationByInvitation.set(operation.invitationId, updated);
      }
      return Promise.resolve();
    },
  };

  beforeEach(() => {
    fleetState.status = 'PENDING';
    operationByKey.clear();
    operationByInvitation.clear();
    bindings.clear();
    auditFacts.length = 0;
  });

  test('creates a pending invitation, then binds once after Fleet reports redemption', async () => {
    const request = new RequestFleetInvitationUseCase(
      nodePort,
      coreBindings,
      fakeFleet.installations,
      fakeFleet.invitations,
      operations,
      unitOfWork,
      outbox as unknown as OutboxWriterPort,
      () => new Date('2026-11-22T00:00:00Z'),
      () => 'operation-1',
    );
    const sync = new SynchronizeFleetEnrollmentUseCase(
      operations,
      fakeFleet.invitations,
      fakeFleet.installations,
      nodePort,
      {
        hasActiveForNode: () => Promise.resolve(bindings.has('node-1')),
        upsert: (input) => {
          const existing = bindings.get(input.nodeId);
          if (existing)
            return Promise.resolve(
              existing === input.installationId ? 'EXISTS' : 'CONFLICT',
            );
          bindings.set(input.nodeId, input.installationId);
          return Promise.resolve('CREATED' as const);
        },
      },
      unitOfWork,
      outbox as unknown as OutboxWriterPort,
      () => new Date('2026-11-22T00:00:00Z'),
      () => 'audit-event-1',
    );

    const invitation = await request.execute({
      nodeId: 'node-1',
      idempotencyKey: 'client-key-00000001',
      actor,
    });
    expect(invitation).toMatchObject({ status: 'PENDING' });
    expect(invitation.invitationToken).toBe(fleetState.token);

    fleetState.status = 'REDEEMED';
    await expect(
      sync.execute({ invitationId: 'invitation-1', actor }),
    ).resolves.toMatchObject({
      status: 'BOUND',
      installationId: 'installation-1',
    });
    expect(bindings.get('node-1')).toBe('installation-1');
    expect(auditFacts).toHaveLength(2); // invitation + enrollment binding
    expect(JSON.stringify(auditFacts)).not.toContain(fleetState.token);

    await sync.execute({ invitationId: 'invitation-1', actor });
    expect(auditFacts).toHaveLength(2);
  });
});
