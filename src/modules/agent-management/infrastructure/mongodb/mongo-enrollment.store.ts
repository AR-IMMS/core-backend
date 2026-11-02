import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type { EnrollmentPersistencePort } from '../../application/registration/ports/enrollment.port';
import {
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  EnrollmentAttemptConflictError,
  InstallationAlreadyBoundError,
  NodeAlreadyBoundError,
} from '../../domain/errors/registration.errors';
import {
  EnrollmentRecoveryUnavailableError,
  EnrollmentUnavailableError,
} from '../../application/registration/errors/enrollment-availability.errors';
import type { EncryptedEnrollmentResult } from '../../application/registration/ports/enrollment-recovery.port';

@Injectable()
export class MongoEnrollmentStore implements EnrollmentPersistencePort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findAttempt(attemptId: string) {
    const attempt = await this.connection
      .collection('agent_management_enrollment_attempts')
      .findOne({ attemptId });
    if (!attempt) return null;
    if (
      typeof attempt['requestFingerprint'] !== 'string' ||
      typeof attempt['status'] !== 'string' ||
      !(attempt['committedAt'] instanceof Date) ||
      typeof attempt['bindingId'] !== 'string' ||
      typeof attempt['installationId'] !== 'string'
    ) {
      throw new EnrollmentRecoveryUnavailableError();
    }
    return {
      requestFingerprint: attempt['requestFingerprint'],
      status: attempt['status'],
      committedAt: attempt['committedAt'],
      bindingId: attempt['bindingId'],
      installationId: attempt['installationId'],
    };
  }

  async findRecovery(attemptId: string) {
    const recovery = await this.connection
      .collection('agent_management_enrollment_recovery')
      .findOne({ attemptId });
    if (!recovery) return null;
    const requestFingerprint: unknown = recovery['requestFingerprint'];
    const expiresAt: unknown = recovery['expiresAt'];
    const encryptedResult: unknown = recovery['encryptedResult'];
    if (
      typeof requestFingerprint !== 'string' ||
      !(expiresAt instanceof Date) ||
      !isEncryptedEnrollmentResult(encryptedResult)
    ) {
      throw new EnrollmentRecoveryUnavailableError();
    }
    return {
      requestFingerprint,
      expiresAt,
      encryptedResult,
    };
  }

  async findToken(tokenHash: string) {
    const token = await this.connection
      .collection('agent_management_bootstrap_tokens')
      .findOne({ tokenHash });
    if (
      !token ||
      typeof token.nodeId !== 'string' ||
      !(token.expiresAt instanceof Date)
    )
      return null;
    return {
      nodeId: token.nodeId,
      status: typeof token.status === 'string' ? token.status : 'invalid',
      expiresAt: token.expiresAt,
    };
  }

  async hasActiveBinding(nodeId: string): Promise<boolean> {
    return (
      (await this.connection
        .collection('agent_management_bindings')
        .countDocuments({ nodeId, status: 'active' })) > 0
    );
  }

  async isEnrollmentResultActive(input: {
    readonly attemptId: string;
    readonly bindingId: string;
    readonly installationId: string;
  }): Promise<boolean> {
    const attempt = await this.connection
      .collection('agent_management_enrollment_attempts')
      .findOne(
        { attemptId: input.attemptId },
        {
          projection: {
            bindingId: 1,
            credentialId: 1,
            installationId: 1,
          },
        },
      );
    if (
      !attempt ||
      attempt['bindingId'] !== input.bindingId ||
      attempt['installationId'] !== input.installationId ||
      typeof attempt['credentialId'] !== 'string'
    ) {
      return false;
    }

    const [binding, credential, installation] = await Promise.all([
      this.connection.collection('agent_management_bindings').findOne({
        bindingId: input.bindingId,
        installationId: input.installationId,
        status: 'active',
      }),
      this.connection.collection('agent_management_credentials').findOne({
        credentialId: attempt['credentialId'],
        bindingId: input.bindingId,
        status: 'active',
      }),
      this.connection
        .collection('agent_management_installations')
        .findOne({ installationId: input.installationId }),
    ]);
    return Boolean(binding && credential && installation);
  }

  async enroll(
    input: Parameters<EnrollmentPersistencePort['enroll']>[0],
    context: UnitOfWorkContext,
  ): Promise<void> {
    const session = context as unknown as import('mongoose').ClientSession;
    const tokens = this.connection.collection(
      'agent_management_bootstrap_tokens',
    );
    const options = { session };
    const consumed = await tokens.updateOne(
      {
        tokenHash: input.tokenHash,
        status: 'active',
        expiresAt: { $gt: input.now },
      },
      { $set: { status: 'consumed', consumedAt: input.now } },
      options,
    );
    if (consumed.modifiedCount !== 1) {
      const current = await tokens.findOne(
        { tokenHash: input.tokenHash },
        { session, projection: { status: 1, expiresAt: 1 } },
      );
      if (current?.status === 'consumed')
        throw new BootstrapTokenConsumedError();
      if (
        current?.status === 'active' &&
        current.expiresAt instanceof Date &&
        current.expiresAt.getTime() <= input.now.getTime()
      ) {
        throw new BootstrapTokenExpiredError();
      }
      throw new BootstrapTokenInvalidError();
    }

    try {
      const installations = this.connection.collection(
        'agent_management_installations',
      );
      const existingInstallation = await installations.updateOne(
        { installationId: input.installationId },
        {
          $set: {
            agentVersion: input.agentVersion,
            environment: input.environment,
            metadata: input.metadata,
            updatedAt: input.now,
          },
        },
        options,
      );
      if (existingInstallation.matchedCount === 0) {
        await installations.insertOne(
          {
            installationId: input.installationId,
            enrollmentId: input.enrollmentId,
            agentVersion: input.agentVersion,
            environment: input.environment,
            metadata: input.metadata,
            createdAt: input.now,
          },
          options,
        );
      }
      const token = await tokens.findOne(
        { tokenHash: input.tokenHash },
        { session, projection: { nodeId: 1 } },
      );
      if (!token || typeof token.nodeId !== 'string')
        throw new BootstrapTokenConsumedError();
      await this.connection.collection('agent_management_bindings').insertOne(
        {
          bindingId: input.bindingId,
          installationId: input.installationId,
          nodeId: token.nodeId,
          status: 'active',
          createdAt: input.now,
        },
        options,
      );
      await this.connection
        .collection('agent_management_credentials')
        .insertOne(
          {
            credentialId: input.credentialId,
            bindingId: input.bindingId,
            credentialHash: input.credentialHash,
            status: 'active',
            createdAt: input.now,
          },
          options,
        );
      await this.connection
        .collection('agent_management_enrollment_attempts')
        .insertOne(
          {
            attemptId: input.attemptId,
            installationId: input.installationId,
            requestFingerprint: input.requestFingerprint,
            bindingId: input.bindingId,
            credentialId: input.credentialId,
            status: 'committed',
            committedAt: input.now,
          },
          options,
        );
      await this.connection
        .collection('agent_management_enrollment_recovery')
        .insertOne(
          {
            attemptId: input.attemptId,
            requestFingerprint: input.requestFingerprint,
            encryptedResult: input.encryptedResult,
            committedAt: input.now,
            expiresAt: input.recoveryExpiresAt,
          },
          options,
        );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const keyPattern = duplicateKeyPattern(error);
      if (keyPattern?.['nodeId']) throw new NodeAlreadyBoundError();
      if (keyPattern?.['installationId'])
        throw new InstallationAlreadyBoundError();
      if (keyPattern?.['attemptId']) throw new EnrollmentAttemptConflictError();
      throw new EnrollmentUnavailableError();
    }
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 11000
  );
}

function duplicateKeyPattern(error: unknown): Record<string, unknown> | null {
  if (typeof error !== 'object' || error === null || !('keyPattern' in error))
    return null;
  const pattern: unknown = error.keyPattern;
  return typeof pattern === 'object' && pattern !== null
    ? (pattern as Record<string, unknown>)
    : null;
}

function isEncryptedEnrollmentResult(
  value: unknown,
): value is EncryptedEnrollmentResult {
  if (typeof value !== 'object' || value === null) return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result['keyVersion'] === 'string' &&
    typeof result['iv'] === 'string' &&
    typeof result['ciphertext'] === 'string' &&
    typeof result['authTag'] === 'string'
  );
}
