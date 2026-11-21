import z from 'zod';
import type { HumanPrincipal } from '@modules/iam';
import type {
  MappingProvisioningAuthorityPort,
  ProvisionMappingRequest,
} from '../application/provision-identity-mapping';

const configSchema = z
  .object({
    enabled: z.literal(true),
    environment: z.literal('development'),
    administratorId: z.string().uuid(),
    instanceKey: z.string().min(1).max(128),
    approvedGroupId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    approvalReference: z.string().trim().min(1).max(512),
    pairs: z
      .array(
        z.object({
          coreUserId: z.string().uuid(),
          zammadUserId: z
            .number()
            .int()
            .positive()
            .max(Number.MAX_SAFE_INTEGER),
        }),
      )
      .min(1),
  })
  .strict();
export type LocalProvisioningApproval = z.infer<typeof configSchema>;
/** Operational authentication boundary, backed by the public Core auth/me API.
 * Never resolve this principal from a caller-supplied actor ID or a decoded unverified JWT.
 */
export interface OperationalActorPort {
  authenticate(): Promise<HumanPrincipal>;
}
/** Opt-in local authority. No environment configuration means no grants. */
export class LocalProvisioningAuthority implements MappingProvisioningAuthorityPort {
  private readonly approval: LocalProvisioningApproval | null;
  constructor(
    configuration: unknown,
    private readonly actors: OperationalActorPort,
  ) {
    if (configuration === undefined) {
      this.approval = null;
      return;
    }
    const parsed = configSchema.safeParse(configuration);
    if (!parsed.success) throw new Error('Invalid local provisioning approval');
    const approval = parsed.data;
    if (
      new Set(approval.pairs.map((p) => p.coreUserId)).size !==
        approval.pairs.length ||
      new Set(approval.pairs.map((p) => p.zammadUserId)).size !==
        approval.pairs.length ||
      approval.pairs.some((p) => p.coreUserId === approval.administratorId)
    )
      throw new Error('Invalid local provisioning approval');
    this.approval = approval;
  }
  async authorize(request: ProvisionMappingRequest) {
    const approval = this.approval;
    if (
      !approval ||
      request.actorUserId !== approval.administratorId ||
      request.instanceKey !== approval.instanceKey ||
      request.approvedGroupId !== approval.approvedGroupId ||
      !approval.pairs.some(
        (p) =>
          p.coreUserId === request.coreUserId &&
          p.zammadUserId === request.zammadUserId,
      )
    )
      return null;
    const actor = await this.actors.authenticate();
    if (
      actor.userId !== approval.administratorId ||
      actor.role !== 'IT_ADMIN' ||
      actor.status !== 'ACTIVE'
    )
      return null;
    return {
      actorUserId: actor.userId,
      approvalReference: approval.approvalReference,
    };
  }
}
