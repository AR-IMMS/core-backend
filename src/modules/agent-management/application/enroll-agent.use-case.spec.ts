import { createHash } from 'node:crypto';
import type { AuditFactV2 } from '@platform/events';
import { EnrollAgentUseCase } from './enroll-agent.use-case';
import type {
  EnrollmentInput,
  EnrollmentPersistencePort,
} from './enrollment.port';
import {
  AgentNodeNotEligibleError,
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  NodeAlreadyBoundError,
} from './enrollment.port';

describe('EnrollAgentUseCase', () => {
  const request: EnrollmentInput = {
    bootstrapToken: 'arimms_bt_plaintext',
    attemptId: 'd99c38f2-7668-4814-9e70-6416014f83fe',
    installation: { id: '5baf0cba-cf5a-4d39-a3d4-e76263b70810' },
    agent: { version: '0.1.4' },
    environment: { os: 'linux', architecture: 'amd64', hostname: 'node-01' },
    metadata: { deployment_kind: 'vm' },
  };

  function harness() {
    let persistedInput:
      Parameters<EnrollmentPersistencePort['enroll']>[0] | undefined;
    let auditFact: AuditFactV2 | undefined;
    const store = {
      findToken: jest.fn().mockResolvedValue({
        nodeId: 'node-1',
        status: 'active',
        expiresAt: new Date('2026-10-31T10:10:00.000Z'),
      }),
      hasActiveBinding: jest.fn().mockResolvedValue(false),
      enroll: jest.fn(
        (input: Parameters<EnrollmentPersistencePort['enroll']>[0]) => {
          persistedInput = input;
          return Promise.resolve();
        },
      ),
    };
    const nodeEligibility = {
      getEligibility: jest.fn().mockResolvedValue({
        exists: true,
        active: true,
        hasActivePlacement: true,
      }),
      serializeEnrollmentEligibility: jest.fn().mockResolvedValue(true),
    };
    const unitOfWork = {
      run: jest.fn(async (operation: (context: object) => Promise<unknown>) =>
        operation({}),
      ),
    };
    const outbox = {
      append: jest.fn((fact: AuditFactV2) => {
        auditFact = fact;
        return Promise.resolve();
      }),
    };
    const useCase = new EnrollAgentUseCase(
      store,
      nodeEligibility,
      unitOfWork as never,
      outbox as never,
      'https://core.example.test/api/v1/agent-control',
      () => new Date('2026-10-31T10:00:00.000Z'),
      () => Buffer.from('01234567890123456789012345678901'),
      () => 'generated-id',
    );
    return {
      useCase,
      store,
      nodeEligibility,
      unitOfWork,
      outbox,
      getPersistedInput: () => persistedInput,
      getAuditFact: () => auditFact,
    };
  }

  it('consumes the token and returns one credential while persisting only its hash', async () => {
    const { useCase, getPersistedInput, getAuditFact } = harness();
    const result = await useCase.execute(request);
    expect(result).toMatchObject({
      enrollmentId: 'generated-id',
      installationId: request.installation.id,
      binding: { nodeId: 'node-1', status: 'active' },
      controlPlane: {
        baseUrl: 'https://core.example.test/api/v1/agent-control',
        pollIntervalSeconds: 30,
      },
    });
    expect(getPersistedInput()).toEqual(
      expect.objectContaining({
        tokenHash: createHash('sha256')
          .update(request.bootstrapToken)
          .digest('hex'),
        credentialHash: createHash('sha256')
          .update(result.accessToken)
          .digest('hex'),
        attemptId: request.attemptId,
      }),
    );
    expect(typeof getPersistedInput()?.requestFingerprint).toBe('string');
    expect(getPersistedInput()?.requestFingerprint).not.toContain(
      request.bootstrapToken,
    );
    expect(JSON.stringify(getPersistedInput())).not.toContain(
      result.accessToken,
    );
    expect(JSON.stringify(getPersistedInput())).not.toContain(
      request.bootstrapToken,
    );
    expect(JSON.stringify(getAuditFact())).not.toContain(
      request.bootstrapToken,
    );
    expect(JSON.stringify(getAuditFact())).not.toContain(result.accessToken);
  });

  it.each([
    [
      {
        nodeId: 'node-1',
        status: 'invalidated',
        expiresAt: new Date('2026-10-31T10:10:00Z'),
      },
      BootstrapTokenInvalidError,
    ],
    [
      {
        nodeId: 'node-1',
        status: 'active',
        expiresAt: new Date('2026-10-31T09:59:59Z'),
      },
      BootstrapTokenExpiredError,
    ],
    [
      {
        nodeId: 'node-1',
        status: 'consumed',
        expiresAt: new Date('2026-10-31T10:10:00Z'),
      },
      BootstrapTokenConsumedError,
    ],
  ])('rejects non-enrollable token state', async (token, errorName) => {
    const { useCase, store } = harness();
    store.findToken.mockResolvedValue(token);
    await expect(useCase.execute(request)).rejects.toBeInstanceOf(errorName);
    expect(store.enroll).not.toHaveBeenCalled();
  });

  it('rejects an ineligible Node', async () => {
    const { useCase, nodeEligibility, store } = harness();
    nodeEligibility.getEligibility.mockResolvedValue({
      exists: true,
      active: false,
      hasActivePlacement: false,
    });
    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      AgentNodeNotEligibleError,
    );
    expect(store.enroll).not.toHaveBeenCalled();
  });

  it('rejects a Node that already has an active Agent binding', async () => {
    const { useCase, store } = harness();
    store.hasActiveBinding.mockResolvedValue(true);
    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      NodeAlreadyBoundError,
    );
    expect(store.enroll).not.toHaveBeenCalled();
  });

  it('rechecks and serializes Asset eligibility inside the enrollment transaction', async () => {
    const { useCase, nodeEligibility, store, unitOfWork } = harness();
    nodeEligibility.serializeEnrollmentEligibility.mockResolvedValue(false);

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      AgentNodeNotEligibleError,
    );

    expect(nodeEligibility.serializeEnrollmentEligibility).toHaveBeenCalledWith(
      'node-1',
      expect.any(Object),
    );
    expect(store.hasActiveBinding).toHaveBeenCalledTimes(1);
    expect(store.enroll).not.toHaveBeenCalled();
    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
  });

  it('rechecks active Agent bindings inside the enrollment transaction', async () => {
    const { useCase, nodeEligibility, store } = harness();
    store.hasActiveBinding
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      NodeAlreadyBoundError,
    );

    expect(nodeEligibility.serializeEnrollmentEligibility).toHaveBeenCalled();
    expect(store.enroll).not.toHaveBeenCalled();
  });

  it('wraps token consumption, records and audit fact in one unit of work', async () => {
    const { useCase, unitOfWork, store, outbox } = harness();
    await useCase.execute(request);
    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
    expect(store.enroll).toHaveBeenCalledTimes(1);
    expect(outbox.append).toHaveBeenCalledTimes(1);
  });

  it('fails the operation when the audit append fails so the transaction rolls back', async () => {
    const { useCase, unitOfWork, outbox } = harness();
    outbox.append.mockRejectedValue(new Error('outbox unavailable'));
    await expect(useCase.execute(request)).rejects.toThrow(
      'outbox unavailable',
    );
    expect(unitOfWork.run).toHaveBeenCalledTimes(1);
  });
});
