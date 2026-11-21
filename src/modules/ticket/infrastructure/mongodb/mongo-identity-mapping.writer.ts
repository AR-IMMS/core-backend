import type { ClientSession, Model } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import {
  MappingProvisioningError,
  type IdentityMappingWritePort,
} from '../../application/provision-identity-mapping';
import {
  validateIdentityMapping,
  type IdentityMapping,
} from '../../domain/identity-mapping';
/** Internal transaction-only insert. Indexes include revoked records; no upsert or rebind. */
export class MongoIdentityMappingWriter implements IdentityMappingWritePort {
  constructor(private readonly model: Model<IdentityMapping>) {}
  async insert(
    input: IdentityMapping,
    context: UnitOfWorkContext,
  ): Promise<void> {
    const mapping = validateIdentityMapping(input);
    const session = context as unknown as ClientSession;
    if (
      !session ||
      typeof session.inTransaction !== 'function' ||
      !session.inTransaction()
    )
      throw new MappingProvisioningError('DEPENDENCY_FAILURE');
    try {
      await this.model.create([mapping], { session });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw new MappingProvisioningError('CONFLICT');
      throw new MappingProvisioningError('DEPENDENCY_FAILURE');
    }
  }
}
