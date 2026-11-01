import type { UnitOfWorkContext } from '@platform/events';
import type { EncryptedEnrollmentResult } from './enrollment-recovery.port';

export interface EnrollmentInput {
  readonly bootstrapToken: string;
  readonly attemptId: string;
  readonly installation: { readonly id: string };
  readonly agent: { readonly version: string };
  readonly environment: {
    readonly os: string;
    readonly architecture: string;
    readonly hostname?: string;
  };
  readonly metadata?: Record<string, unknown>;
}

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
  hasActiveBinding(nodeId: string): Promise<boolean>;
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

export class BootstrapTokenInvalidError extends Error {}
export class BootstrapTokenExpiredError extends Error {}
export class BootstrapTokenConsumedError extends Error {}
export class AgentNodeNotEligibleError extends Error {}
export class NodeAlreadyBoundError extends Error {}
export class InstallationAlreadyBoundError extends Error {}
export class EnrollmentAttemptConflictError extends Error {}
export class EnrollmentRecoveryExpiredError extends Error {}
export class EnrollmentRecoveryRevokedError extends Error {}
export class EnrollmentRecoveryUnavailableError extends Error {}
export class EnrollmentUnavailableError extends Error {}
