import { Types, type Model } from 'mongoose';
import type {
  IdentityMappingDirectory,
  IdentityMappingReadPort,
} from '../../application/identity-mapping-read.port';
import {
  IdentityMappingError,
  validateCoreUserId,
  validateIdentityMapping,
  validateMappingScope,
  type IdentityMapping,
  type MappingScope,
} from '../../domain/identity-mapping';
/** Exact scoped reads, no writes or provisioning authority. */
export class MongoIdentityMappingStore
  implements IdentityMappingReadPort, IdentityMappingDirectory
{
  private readonly scope: MappingScope;
  constructor(
    private readonly model: Model<IdentityMapping>,
    scope: MappingScope,
  ) {
    validateMappingScope(scope);
    this.scope = Object.freeze({ ...scope });
  }
  async listCandidates(after: string | undefined, limit: number) {
    try {
      const records = await this.model
        .find({
          instanceKey: this.scope.instanceKey,
          approvedGroupId: this.scope.approvedGroupId,
          status: 'ACTIVE',
          ...(after === undefined
            ? {}
            : { _id: { $gt: new Types.ObjectId(after) } }),
        })
        .sort({ _id: 1 })
        .select('coreUserId')
        .limit(limit)
        .lean()
        .exec();
      return records.map((row) => {
        validateCoreUserId(row.coreUserId);
        return { id: row.coreUserId, cursor: row._id.toHexString() };
      });
    } catch {
      throw new IdentityMappingError('MAPPING_UNAVAILABLE');
    }
  }
  async findActiveMappingByExternalId(
    zammadUserId: number,
  ): Promise<IdentityMapping | null> {
    if (!Number.isSafeInteger(zammadUserId) || zammadUserId <= 0)
      throw new IdentityMappingError('INVALID_MAPPING');
    try {
      const rows = await this.model
        .find({ instanceKey: this.scope.instanceKey, zammadUserId })
        .limit(2)
        .lean()
        .exec();
      if (!rows.length) return null;
      if (rows.length !== 1)
        throw new IdentityMappingError('MAPPING_INTEGRITY');
      const row = validateIdentityMapping(rows[0]);
      const checked = await this.findActiveMapping(row.coreUserId);
      if (checked && checked.zammadUserId !== zammadUserId)
        throw new IdentityMappingError('MAPPING_INTEGRITY');
      return checked;
    } catch (error) {
      if (error instanceof IdentityMappingError) {
        if (error.code === 'INVALID_MAPPING')
          throw new IdentityMappingError('MAPPING_INTEGRITY');
        throw error;
      }
      throw new IdentityMappingError('MAPPING_UNAVAILABLE');
    }
  }
  async findActiveMapping(coreUserId: string): Promise<IdentityMapping | null> {
    validateCoreUserId(coreUserId);
    try {
      const rows = await this.model
        .find({ instanceKey: this.scope.instanceKey, coreUserId })
        .limit(2)
        .lean()
        .exec();
      if (!rows.length) return null;
      if (rows.length !== 1)
        throw new IdentityMappingError('MAPPING_INTEGRITY');
      const row = validateIdentityMapping(rows[0]);
      const reverse = await this.model
        .find({
          instanceKey: this.scope.instanceKey,
          zammadUserId: row.zammadUserId,
        })
        .limit(2)
        .select('coreUserId')
        .lean()
        .exec();
      if (reverse.length !== 1 || reverse[0].coreUserId !== coreUserId)
        throw new IdentityMappingError('MAPPING_INTEGRITY');
      if (
        row.status !== 'ACTIVE' ||
        row.approvedGroupId !== this.scope.approvedGroupId
      )
        return null;
      return row;
    } catch (error) {
      if (error instanceof IdentityMappingError) {
        if (error.code === 'INVALID_MAPPING')
          throw new IdentityMappingError('MAPPING_INTEGRITY');
        throw error;
      }
      throw new IdentityMappingError('MAPPING_UNAVAILABLE');
    }
  }
}
