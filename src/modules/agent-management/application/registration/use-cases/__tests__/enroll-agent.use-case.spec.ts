import { createHash } from 'node:crypto';
import type { AuditFactV2 } from '@platform/events';
import { EnrollAgentUseCase } from '../enroll-agent.use-case';
import type { EnrollmentInput } from '../../enrollment-input';
import type { EnrollmentPersistencePort } from '../../ports/enrollment.port';
import {
  AgentNodeNotEligibleError,
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  EnrollmentAttemptConflictError,
  EnrollmentRecoveryExpiredError,
  EnrollmentRecoveryRevokedError,
  NodeAlreadyBoundError,
} from '../../../../domain/errors/registration.errors';

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
      findAttempt: jest.fn().mockResolvedValue(null),
      findRecovery: jest.fn().mockResolvedValue(null),
      isEnrollmentResultActive: jest.fn().mockResolvedValue(true),
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
      {
        encrypt: jest.fn((plaintext: string) => ({
          keyVersion: 'v1',
          iv: 'test-iv',
          ciphertext: Buffer.from(plaintext).toString('base64'),
          authTag: 'test-tag',
        })),
        decrypt: jest.fn((encrypted: { ciphertext: string }) =>
          Buffer.from(encrypted.ciphertext, 'base64').toString(),
        ),
      },
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
        recoveryExpiresAt: new Date('2026-11-01T10:00:00.000Z'),
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

  it('returns the saved credential for a matching committed retry without reading token state', async () => {
    const { useCase, store, getPersistedInput } = harness();
    const created = await useCase.execute(request);
    const fingerprint = getPersistedInput()?.requestFingerprint;
    expect(fingerprint).toBeDefined();

    store.findAttempt.mockResolvedValue({
      requestFingerprint: fingerprint,
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });
    store.findRecovery.mockResolvedValue({
      requestFingerprint: fingerprint,
      expiresAt: new Date('2026-11-01T10:00:00.000Z'),
      encryptedResult: {
        ciphertext: Buffer.from(
          JSON.stringify({
            enrollmentId: created.enrollmentId,
            installationId: created.installationId,
            binding: created.binding,
            accessToken: created.accessToken,
            controlPlane: created.controlPlane,
          }),
        ).toString('base64'),
      },
    });

    const recovered = await useCase.execute(request);

    expect(recovered).toMatchObject({
      enrollmentId: created.enrollmentId,
      accessToken: created.accessToken,
      recovered: true,
    });
    expect(store.findToken).toHaveBeenCalledTimes(1);
    expect(store.enroll).toHaveBeenCalledTimes(1);
  });

  it('rejects a retry with a changed request fingerprint', async () => {
    const { useCase, store } = harness();
    store.findAttempt.mockResolvedValue({
      requestFingerprint: 'different-request',
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      EnrollmentAttemptConflictError,
    );
    expect(store.findToken).not.toHaveBeenCalled();
  });

  it('does not authorize recovery from attempt ID without the original token', async () => {
    const { useCase, store, getPersistedInput } = harness();
    await useCase.execute(request);
    store.findAttempt.mockResolvedValue({
      requestFingerprint: getPersistedInput()?.requestFingerprint,
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });

    await expect(
      useCase.execute({ ...request, bootstrapToken: 'different-secret' }),
    ).rejects.toBeInstanceOf(EnrollmentAttemptConflictError);
    expect(store.findRecovery).not.toHaveBeenCalled();
    expect(store.enroll).toHaveBeenCalledTimes(1);
  });

  it('rejects recovery after the stored expiry even when TTL cleanup has not run', async () => {
    const { useCase, store, getPersistedInput } = harness();
    await useCase.execute(request);
    const fingerprint = getPersistedInput()?.requestFingerprint;
    store.findAttempt.mockResolvedValue({
      requestFingerprint: fingerprint,
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });
    store.findRecovery.mockResolvedValue({
      requestFingerprint: fingerprint,
      expiresAt: new Date('2026-10-31T09:59:59.000Z'),
      encryptedResult: {
        keyVersion: 'v1',
        iv: 'test-iv',
        ciphertext: 'unused',
        authTag: 'test-tag',
      },
    });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      EnrollmentRecoveryExpiredError,
    );
  });

  it('does not return the escrowed credential after its binding is revoked', async () => {
    const { useCase, store, getPersistedInput } = harness();
    await useCase.execute(request);
    const persisted = getPersistedInput();
    store.findAttempt.mockResolvedValue({
      requestFingerprint: persisted?.requestFingerprint ?? '',
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });
    store.findRecovery.mockResolvedValue({
      requestFingerprint: persisted?.requestFingerprint ?? '',
      expiresAt: new Date('2026-11-01T10:00:00.000Z'),
      encryptedResult: persisted!.encryptedResult,
    });
    store.isEnrollmentResultActive.mockResolvedValue(false);

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      EnrollmentRecoveryRevokedError,
    );
  });

  it('checks current binding and credential state immediately before recovering', async () => {
    const { useCase, store, getPersistedInput } = harness();
    const created = await useCase.execute(request);
    const persisted = getPersistedInput();
    store.findAttempt.mockResolvedValue({
      requestFingerprint: persisted?.requestFingerprint ?? '',
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });
    store.findRecovery.mockResolvedValue({
      requestFingerprint: persisted?.requestFingerprint ?? '',
      expiresAt: new Date('2026-11-01T10:00:00.000Z'),
      encryptedResult: persisted!.encryptedResult,
    });
    store.isEnrollmentResultActive.mockImplementation(async () => {
      await Promise.resolve();
      return false;
    });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      EnrollmentRecoveryRevokedError,
    );
    expect(store.isEnrollmentResultActive).toHaveBeenCalledWith({
      attemptId: request.attemptId,
      bindingId: created.binding.id,
      installationId: request.installation.id,
    });
  });

  it('fingerprints equivalent nested request objects deterministically', async () => {
    const firstHarness = harness();
    const secondHarness = harness();
    const firstInput = {
      ...request,
      metadata: { z: { second: 2, first: 1 }, a: true },
    };
    const secondInput = {
      ...request,
      metadata: { a: true, z: { first: 1, second: 2 } },
    };

    await firstHarness.useCase.execute(firstInput);
    await secondHarness.useCase.execute(secondInput);

    expect(firstHarness.getPersistedInput()?.requestFingerprint).toBe(
      secondHarness.getPersistedInput()?.requestFingerprint,
    );
  });

  it('expires a matching legacy attempt that has no escrow result', async () => {
    const { useCase, store, getPersistedInput } = harness();
    await useCase.execute(request);
    const fingerprint = getPersistedInput()?.requestFingerprint;
    store.findAttempt.mockResolvedValue({
      requestFingerprint: fingerprint,
      status: 'committed',
      committedAt: new Date('2026-10-31T10:00:00.000Z'),
      bindingId: 'generated-id',
      installationId: request.installation.id,
    });

    await expect(useCase.execute(request)).rejects.toBeInstanceOf(
      EnrollmentRecoveryExpiredError,
    );
    expect(store.findToken).toHaveBeenCalledTimes(1);
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

  it('recovers a committed result when transaction completion reports an unknown outcome', async () => {
    const { useCase, store, unitOfWork, getPersistedInput } = harness();
    store.findAttempt.mockResolvedValueOnce(null).mockImplementationOnce(() =>
      Promise.resolve({
        requestFingerprint: getPersistedInput()?.requestFingerprint ?? '',
        status: 'committed',
        committedAt: new Date('2026-10-31T10:00:00.000Z'),
        bindingId: getPersistedInput()?.bindingId ?? '',
        installationId: request.installation.id,
      }),
    );
    store.findRecovery.mockImplementation(() =>
      Promise.resolve({
        requestFingerprint: getPersistedInput()?.requestFingerprint ?? '',
        expiresAt: new Date('2026-11-01T10:00:00.000Z'),
        encryptedResult: {
          keyVersion: 'v1',
          iv: 'test-iv',
          ciphertext: Buffer.from(
            JSON.stringify({
              enrollmentId: 'committed-enrollment',
              installationId: request.installation.id,
              binding: {
                id: getPersistedInput()?.bindingId ?? 'binding',
                nodeId: 'node-1',
                status: 'active',
              },
              accessToken: 'committed-credential',
              controlPlane: {
                baseUrl: 'https://core.example.test/api/v1/agent-control',
                pollIntervalSeconds: 30,
              },
            }),
          ).toString('base64'),
          authTag: 'test-tag',
        },
      }),
    );
    unitOfWork.run.mockImplementationOnce(async (operation) => {
      await operation({});
      throw new Error('unknown transaction outcome');
    });

    await expect(useCase.execute(request)).resolves.toMatchObject({
      enrollmentId: 'committed-enrollment',
      accessToken: 'committed-credential',
      recovered: true,
    });
  });
});
