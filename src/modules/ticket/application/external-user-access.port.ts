/** Eligibility for a positively provisioned human, not Core resource authorization. */
export interface ExternalUserAccessPort {
  getEligibleHuman(id: number): Promise<{
    readonly externalUserId: number;
    readonly groupId: number;
  } | null>;
}
export const EXTERNAL_USER_ACCESS_PORT = Symbol('EXTERNAL_USER_ACCESS_PORT');
export class ExternalUserAccessError extends Error {
  constructor(
    readonly code:
      | 'INVALID_USER_ID'
      | 'SERVICE_IDENTITY_MISMATCH'
      | 'INVALID_UPSTREAM_RESPONSE',
  ) {
    super(`External user access failed: ${code}`);
  }
}
