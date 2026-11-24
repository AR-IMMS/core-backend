import type { IdentityMapping } from '../domain/identity-mapping';
/** Resolves configuration only. Caller must separately validate live IAM/Zammad access. */
export interface IdentityMappingReadPort {
  findActiveMappingByExternalId(
    zammadUserId: number,
  ): Promise<IdentityMapping | null>;
  findActiveMapping(coreUserId: string): Promise<IdentityMapping | null>;
}
export interface IdentityMappingDirectory {
  listCandidates(
    after: string | undefined,
    limit: number,
  ): Promise<{ id: string; cursor: string }[]>;
}
export const IDENTITY_MAPPING_DIRECTORY = Symbol('IDENTITY_MAPPING_DIRECTORY');
export const IDENTITY_MAPPING_READ_PORT = Symbol('IDENTITY_MAPPING_READ_PORT');
