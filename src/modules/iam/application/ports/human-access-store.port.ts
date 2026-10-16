import type { IamUser } from '../../domain/user';

/** IAM-internal read boundary for the current access state of one account. */
export interface HumanAccessStorePort {
  findByUserId(userId: string): Promise<IamUser | null>;
}
