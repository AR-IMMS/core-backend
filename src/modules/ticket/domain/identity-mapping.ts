/** Ticket-owned identity configuration, never a canonical Ticket. */
export interface IdentityMapping {
  readonly instanceKey: string;
  readonly coreUserId: string;
  readonly zammadUserId: number;
  readonly approvedGroupId: number;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly revision: number;
  readonly approvedByCoreUserId: string;
  readonly approvalReference: string;
  readonly validatedAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
export interface MappingScope {
  readonly instanceKey: string;
  readonly approvedGroupId: number;
}
export class IdentityMappingError extends Error {
  constructor(
    readonly code:
      'INVALID_MAPPING' | 'MAPPING_INTEGRITY' | 'MAPPING_UNAVAILABLE',
  ) {
    super(code);
  }
}
export function validateMappingScope(scope: MappingScope): void {
  if (
    typeof scope.instanceKey !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(scope.instanceKey) ||
    !Number.isSafeInteger(scope.approvedGroupId) ||
    scope.approvedGroupId <= 0
  ) {
    throw new IdentityMappingError('INVALID_MAPPING');
  }
}
export function validateCoreUserId(id: string): void {
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    id !== id.trim() ||
    id.length > 128
  ) {
    throw new IdentityMappingError('INVALID_MAPPING');
  }
}
/** Validates persisted configuration; ACTIVE is not proof of current IAM access. */
export function validateIdentityMapping(
  value: IdentityMapping,
): IdentityMapping {
  validateMappingScope(value);
  validateCoreUserId(value.coreUserId);
  validateCoreUserId(value.approvedByCoreUserId);
  if (
    !Number.isSafeInteger(value.zammadUserId) ||
    value.zammadUserId <= 0 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !['ACTIVE', 'REVOKED'].includes(value.status) ||
    typeof value.approvalReference !== 'string' ||
    !value.approvalReference.trim() ||
    value.approvalReference.length > 512 ||
    ![value.validatedAt, value.createdAt, value.updatedAt].every(
      (date) => date instanceof Date && Number.isFinite(date.getTime()),
    ) ||
    value.updatedAt < value.createdAt
  ) {
    throw new IdentityMappingError('INVALID_MAPPING');
  }
  return Object.freeze({ ...value });
}
