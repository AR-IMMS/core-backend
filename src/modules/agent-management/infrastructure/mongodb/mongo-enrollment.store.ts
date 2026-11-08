import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import type { EnrollmentPersistencePort } from '../../application/enrollment.port';
import {
  BootstrapTokenConsumedError,
  BootstrapTokenExpiredError,
  BootstrapTokenInvalidError,
  EnrollmentAttemptConflictError,
  EnrollmentUnavailableError,
  InstallationAlreadyBoundError,
  NodeAlreadyBoundError,
} from '../../application/enrollment.port';

@Injectable()
export class MongoEnrollmentStore implements EnrollmentPersistencePort {
  constructor(@InjectConnection() private readonly connection: Connection) {}

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

  async hasActiveBinding(
    nodeId: string,
    context?: UnitOfWorkContext,
  ): Promise<boolean> {
    const session = context as unknown as
      import('mongoose').ClientSession | undefined;
    return (
      (await this.connection
        .collection('agent_management_bindings')
        .countDocuments(
          { nodeId, status: 'active' },
          session ? { session } : undefined,
        )) > 0
    );
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
      await this.connection
        .collection('agent_management_installations')
        .insertOne(
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
