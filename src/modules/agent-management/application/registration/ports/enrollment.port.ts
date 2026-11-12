import type { UnitOfWorkContext } from '@platform/events';
import type { EncryptedEnrollmentResult } from './enrollment-recovery.port';
import type { EnrollmentInput } from '../enrollment-input';

export interface EnrollmentPersistencePort {
  findAttempt(attemptId: string): Promise<{
    readonly requestFingerprint: string;
    readonly status: string;
    readonly committedAt: Date;
    readonly bindingId: string;
    readonly installationId: string;
  } | null>;
  findRecovery(attemptId: string): Promise<{
    readonly requestFingerprint: string;
    readonly expiresAt: Date;
    readonly encryptedResult: EncryptedEnrollmentResult;
  } | null>;
  findToken(tokenHash: string): Promise<{
    readonly nodeId: string;
    readonly status: string;
    readonly expiresAt: Date;
  } | null>;
  hasActiveBinding(
    nodeId: string,
    context?: UnitOfWorkContext,
  ): Promise<boolean>;
  isEnrollmentResultActive(input: {
    readonly attemptId: string;
    readonly bindingId: string;
    readonly installationId: string;
  }): Promise<boolean>;
  enroll(
    input: {
      readonly tokenHash: string;
      readonly now: Date;
      readonly attemptId: string;
      readonly requestFingerprint: string;
      readonly installationId: string;
      readonly enrollmentId: string;
      readonly agentVersion: string;
      readonly environment: EnrollmentInput['environment'];
      readonly metadata: Record<string, unknown>;
      readonly bindingId: string;
      readonly credentialId: string;
      readonly credentialHash: string;
      readonly recoveryExpiresAt: Date;
      readonly encryptedResult: EncryptedEnrollmentResult;
    },
    context: UnitOfWorkContext,
  ): Promise<void>;
}

export const ENROLLMENT_PERSISTENCE_PORT = Symbol(
  'ENROLLMENT_PERSISTENCE_PORT',
);
