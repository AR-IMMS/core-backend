import type { RoleCode, PermissionCode } from '../../domain/role-permissions';
import type { UnitOfWorkContext } from '@platform/events';

/** Credential-bearing IAM account projection; never return this from HTTP. */
export interface HumanCredentialRecord {
  readonly userId: string;
  readonly username: string;
  readonly email: string;
  readonly normalizedUsername: string;
  readonly normalizedEmail: string;
  readonly displayName: string | null;
  readonly role: RoleCode;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly additionalPermissions: readonly PermissionCode[];
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly auditSequence: number;
}

/** IAM account operations required by bootstrap and authentication. */
export interface HumanAuthStorePort {
  findByIdentifier(
    this: void,
    identifier: string,
  ): Promise<HumanCredentialRecord | null>;
  findByUserId(
    this: void,
    userId: string,
    context?: UnitOfWorkContext,
  ): Promise<HumanCredentialRecord | null>;
  hasAnyItAdmin(this: void, context: UnitOfWorkContext): Promise<boolean>;
  createInitialAdmin(
    this: void,
    input: {
      readonly userId: string;
      readonly username: string;
      readonly normalizedUsername: string;
      readonly email: string;
      readonly normalizedEmail: string;
      readonly passwordHash: string;
      readonly displayName: string | null;
      readonly auditSequence: 0;
    },
    context: UnitOfWorkContext,
  ): Promise<void>;
  createProvisionedUser(
    this: void,
    input: {
      readonly userId: string;
      readonly username: string;
      readonly normalizedUsername: string;
      readonly email: string;
      readonly normalizedEmail: string;
      readonly displayName: string | null;
      readonly role: RoleCode;
      readonly passwordHash: string;
      readonly auditSequence: 0;
    },
    context: UnitOfWorkContext,
  ): Promise<void>;
  updatePasswordWithAuditSequence(
    this: void,
    input: {
      readonly userId: string;
      readonly expectedSequence: number;
      readonly passwordHash: string;
      readonly changedAt: Date;
    },
    context: UnitOfWorkContext,
  ): Promise<number | null>;
  allocateAuditSequence(
    this: void,
    userId: string,
    expectedSequence: number,
    context: UnitOfWorkContext,
  ): Promise<number | null>;
  updatePassword(
    this: void,
    input: {
      readonly userId: string;
      readonly passwordHash: string;
      readonly changedAt: Date;
    },
  ): Promise<boolean>;
}

/** Server-side session persistence required for token rotation and revocation. */
export interface HumanSessionStorePort {
  create(
    this: void,
    input: {
      readonly sessionId: string;
      readonly userId: string;
      readonly refreshTokenHash: string;
      readonly expiresAt: Date;
    },
  ): Promise<void>;
  findByRefreshTokenHash(
    this: void,
    hash: string,
  ): Promise<{
    readonly sessionId: string;
    readonly userId: string;
    readonly expiresAt: Date;
    readonly revokedAt: Date | null;
    readonly isCurrentToken: boolean;
  } | null>;
  rotateRefreshToken(
    this: void,
    input: {
      readonly sessionId: string;
      readonly currentTokenHash: string;
      readonly nextTokenHash: string;
      readonly now: Date;
    },
  ): Promise<boolean>;
  revokeSession(this: void, sessionId: string, at: Date): Promise<void>;
  revokeSessionsExcept(
    this: void,
    userId: string,
    currentSessionId: string,
    at: Date,
    context?: UnitOfWorkContext,
  ): Promise<void>;
  revokeByUsedRefreshTokenHash(
    this: void,
    hash: string,
    at: Date,
  ): Promise<boolean>;
}
