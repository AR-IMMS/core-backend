import type { HumanPrincipal } from './human-access.port';
import type { PermissionCode } from '../../domain/role-permissions';
import type { UserPresencePreference } from '../../domain/user-presence';

/** Principal bound to a verified, active server-side session. */
export interface AuthenticatedHumanPrincipal extends HumanPrincipal {
  readonly sessionId: string;
  readonly mustChangePassword: boolean;
  readonly username: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly effectivePermissions: readonly PermissionCode[];
  readonly presencePreference: UserPresencePreference;
}

/** Verifies access-token signature and extracts only user and session identity. */
export interface AccessTokenVerifierPort {
  verifyAccessToken(
    this: void,
    token: string,
  ): Promise<{
    readonly userId: string;
    readonly sessionId: string;
  } | null>;
}

/** Resolves a principal only when both account and server-side session are active. */
export interface HumanSessionAccessPort {
  getActivePrincipal(
    this: void,
    userId: string,
    sessionId: string,
    now: Date,
  ): Promise<AuthenticatedHumanPrincipal | null>;
}
