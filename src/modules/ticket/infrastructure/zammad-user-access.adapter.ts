import z from 'zod';
import {
  ExternalUserAccessError,
  type ExternalUserAccessPort,
} from '../application/external-user-access.port';
import { ZammadReadClient } from './zammad-read.client';
import {
  parseZammadReadConfig,
  type ZammadReadConfig,
} from './zammad-read.config';
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const userSchema = z.object({
  id,
  active: z.boolean(),
  group_ids: z.record(
    z.string().regex(/^[1-9][0-9]*$/),
    z.array(z.enum(['read', 'create', 'change', 'overview', 'full'])),
  ),
});
const policySchema = z.object({
  serviceUserId: id,
  excludedHumanUserIds: z.array(id).min(1),
});
export type ZammadUserAccessPolicy = z.infer<typeof policySchema>;
/** Version-verified direct-group contract. No role-name/ID inference or role-derived fallback. */
export class ZammadUserAccessAdapter implements ExternalUserAccessPort {
  readonly #client: ZammadReadClient;
  readonly #groupId: number;
  readonly #serviceId: number;
  readonly #excluded: ReadonlySet<number>;
  constructor(config: ZammadReadConfig, policy: ZammadUserAccessPolicy) {
    const checked = parseZammadReadConfig(config);
    const parsed = policySchema.safeParse(policy);
    if (!parsed.success)
      throw new Error('Invalid external user access configuration');
    this.#client = new ZammadReadClient(checked);
    this.#groupId = checked.expectedGroupId;
    this.#serviceId = parsed.data.serviceUserId;
    this.#excluded = new Set([
      ...parsed.data.excludedHumanUserIds,
      this.#serviceId,
    ]);
  }
  async getEligibleHuman(userId: number) {
    if (!Number.isSafeInteger(userId) || userId <= 0)
      throw new ExternalUserAccessError('INVALID_USER_ID');
    if (this.#excluded.has(userId)) return null;
    const service = this.parse(await this.#client.get('users/me'));
    if (!service || service.id !== this.#serviceId || !this.eligible(service))
      throw new ExternalUserAccessError('SERVICE_IDENTITY_MISMATCH');
    const human = this.parse(await this.#client.get(`users/${userId}`));
    if (!human) return null;
    if (human.id !== userId)
      throw new ExternalUserAccessError('INVALID_UPSTREAM_RESPONSE');
    return this.eligible(human)
      ? { externalUserId: human.id, groupId: this.#groupId }
      : null;
  }
  private parse(body: unknown) {
    if (body === null) return null;
    const result = userSchema.safeParse(body);
    if (!result.success)
      throw new ExternalUserAccessError('INVALID_UPSTREAM_RESPONSE');
    return result.data;
  }
  private eligible(user: z.infer<typeof userSchema>) {
    return (
      user.active &&
      user.group_ids[String(this.#groupId)]?.includes('full') === true
    );
  }
}
