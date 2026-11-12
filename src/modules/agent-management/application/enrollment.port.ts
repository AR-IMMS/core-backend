import type { UnitOfWorkContext } from '@platform/events';

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
  findToken(tokenHash: string): Promise<{
    readonly nodeId: string;
    readonly status: string;
    readonly expiresAt: Date;
  } | null>;
  hasActiveBinding(
    nodeId: string,
    context?: UnitOfWorkContext,
  ): Promise<boolean>;
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
export class EnrollmentUnavailableError extends Error {}
