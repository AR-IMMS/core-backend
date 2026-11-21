import type { HumanAccessPort, RoleCode } from '@modules/iam';
import {
  IdentityMappingError,
  type IdentityMapping,
} from '../domain/identity-mapping';
import { TicketReadError, type ExternalTicket } from './ticket-read.port';
import { GetAuthorizedTicket } from './get-authorized-ticket';

const scope = { instanceKey: 'test-instance', approvedGroupId: 42 };
const mapping: IdentityMapping = {
  ...scope,
  coreUserId: 'human',
  zammadUserId: 5,
  status: 'ACTIVE',
  revision: 1,
  approvedByCoreUserId: 'admin',
  approvalReference: 'approved',
  validatedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};
const ownerMapping: IdentityMapping = {
  ...mapping,
  coreUserId: 'owner',
  zammadUserId: 4,
};
const ticket: ExternalTicket = {
  externalTicketId: 17,
  number: '11017',
  title: 'Synthetic',
  groupId: 42,
  nativeOwnerId: 5,
  businessOwner: { kind: 'reference', externalUserId: 4 },
  customerId: 7,
  stateId: 2,
  priorityId: 2,
  createdAt: '2026-11-20T00:00:00Z',
  updatedAt: '2026-11-20T00:00:00Z',
};
function setup(role: RoleCode = 'TECHNICIAN') {
  const iam = {
    getPrincipal: jest
      .fn<
        ReturnType<HumanAccessPort['getPrincipal']>,
        Parameters<HumanAccessPort['getPrincipal']>
      >()
      .mockImplementation((id) =>
        Promise.resolve({
          userId: id,
          role: id === 'human' ? role : 'OPERATOR',
          status: 'ACTIVE',
        }),
      ),
    hasAllPermissions: jest
      .fn<
        ReturnType<HumanAccessPort['hasAllPermissions']>,
        Parameters<HumanAccessPort['hasAllPermissions']>
      >()
      .mockResolvedValue(true),
  };
  const mappings = {
    findActiveMapping: jest
      .fn<Promise<IdentityMapping | null>, [string]>()
      .mockResolvedValue(mapping),
    findActiveMappingByExternalId: jest
      .fn<Promise<IdentityMapping | null>, [number]>()
      .mockImplementation((id) =>
        Promise.resolve(id === 5 ? mapping : ownerMapping),
      ),
  };
  const external = {
    getEligibleHuman: jest
      .fn<
        Promise<{ externalUserId: number; groupId: number } | null>,
        [number]
      >()
      .mockImplementation((id) =>
        Promise.resolve({ externalUserId: id, groupId: 42 }),
      ),
  };
  const tickets = {
    getTicket: jest
      .fn<Promise<ExternalTicket | null>, [number]>()
      .mockResolvedValue(ticket),
  };
  return {
    iam,
    mappings,
    external,
    tickets,
    query: new GetAuthorizedTicket(iam, mappings, external, tickets, scope),
  };
}
describe('internal canonical Ticket authorization', () => {
  it('allows Operator within approved group', async () => {
    const f = setup('OPERATOR');
    await expect(f.query.execute('human', 17)).resolves.toMatchObject({
      status: 'allowed',
      businessOwnerStatus: 'valid',
    });
    expect(f.iam.hasAllPermissions).toHaveBeenCalledWith('human', [
      'ticket:read',
    ]);
  });
  it('allows Technician as current Assignee with valid Business Owner', async () => {
    await expect(setup().query.execute('human', 17)).resolves.toMatchObject({
      status: 'allowed',
    });
  });
  it('allows Technician as current Business Owner', async () => {
    const f = setup();
    f.tickets.getTicket.mockResolvedValue({
      ...ticket,
      nativeOwnerId: 8,
      businessOwner: { kind: 'reference', externalUserId: 5 },
    });
    await expect(f.query.execute('human', 17)).resolves.toMatchObject({
      status: 'allowed',
    });
  });
  it('denies unrelated Technician even when all permissions are granted', async () => {
    const f = setup();
    f.tickets.getTicket.mockResolvedValue({ ...ticket, nativeOwnerId: 8 });
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
  });
  it('denies IT_ADMIN before mapping or Zammad reads despite inherited ticket:read', async () => {
    const f = setup('IT_ADMIN');
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
    expect(f.mappings.findActiveMapping).not.toHaveBeenCalled();
    expect(f.tickets.getTicket).not.toHaveBeenCalled();
  });
  it.each(['missing', 'inactive', 'mismatch'])(
    'denies invalid IAM actor: %s',
    async (kind) => {
      const f = setup();
      f.iam.getPrincipal.mockResolvedValue(
        kind === 'missing'
          ? null
          : {
              userId: kind === 'mismatch' ? 'other' : 'human',
              role: 'TECHNICIAN',
              status: kind === 'inactive' ? 'INACTIVE' : 'ACTIVE',
            },
      );
      await expect(f.query.execute('human', 17)).resolves.toEqual({
        status: 'denied',
      });
      expect(f.mappings.findActiveMapping).not.toHaveBeenCalled();
    },
  );
  it('denies missing ticket:read', async () => {
    const f = setup();
    f.iam.hasAllPermissions.mockResolvedValue(false);
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
    expect(f.external.getEligibleHuman).not.toHaveBeenCalled();
  });
  it.each([
    null,
    { ...mapping, status: 'REVOKED' as const },
    { ...mapping, approvedGroupId: 43 },
    { ...mapping, instanceKey: 'other' },
    { ...mapping, coreUserId: 'other' },
  ])('denies missing/revoked/wrong-scope mapping %#', async (row) => {
    const f = setup();
    f.mappings.findActiveMapping.mockResolvedValue(row);
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
    expect(f.tickets.getTicket).not.toHaveBeenCalled();
  });
  it('fails closed on corrupt mapping', async () => {
    const f = setup();
    f.mappings.findActiveMapping.mockResolvedValue({ ...mapping, revision: 0 });
    await expect(f.query.execute('human', 17)).rejects.toBeInstanceOf(
      IdentityMappingError,
    );
    expect(f.tickets.getTicket).not.toHaveBeenCalled();
  });
  it.each(['MAPPING_INTEGRITY', 'MAPPING_UNAVAILABLE'] as const)(
    'preserves safe mapping failure %s',
    async (code) => {
      const f = setup();
      f.mappings.findActiveMapping.mockRejectedValue(
        new IdentityMappingError(code),
      );
      await expect(f.query.execute('human', 17)).rejects.toMatchObject({
        code,
      });
    },
  );
  it.each([
    null,
    { externalUserId: 5, groupId: 43 },
    { externalUserId: 6, groupId: 42 },
  ])('denies invalid external eligibility %#', async (result) => {
    const f = setup();
    f.external.getEligibleHuman.mockResolvedValue(result);
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
    expect(f.tickets.getTicket).not.toHaveBeenCalled();
  });
  it('distinguishes a missing Ticket from dependency failure', async () => {
    const f = setup();
    f.tickets.getTicket.mockResolvedValue(null);
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'not_found',
    });
  });
  it('denies wrong-group canonical Ticket defensively', async () => {
    const f = setup('OPERATOR');
    f.tickets.getTicket.mockResolvedValue({ ...ticket, groupId: 43 });
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
  });
  it('fails closed on wrong external Ticket identity', async () => {
    const f = setup();
    f.tickets.getTicket.mockResolvedValue({ ...ticket, externalTicketId: 18 });
    await expect(f.query.execute('human', 17)).rejects.toMatchObject({
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  });
  it.each(['missing', 'invalid'] as const)(
    'denies Technician with %s Business Owner even when assigned',
    async (kind) => {
      const f = setup();
      f.tickets.getTicket.mockResolvedValue({
        ...ticket,
        businessOwner: { kind },
      });
      await expect(f.query.execute('human', 17)).resolves.toEqual({
        status: 'denied',
      });
    },
  );
  it.each(['missing', 'invalid'] as const)(
    'allows permitted Operator to inspect %s Business Owner for repair',
    async (kind) => {
      const f = setup('OPERATOR');
      f.tickets.getTicket.mockResolvedValue({
        ...ticket,
        businessOwner: { kind },
      });
      await expect(f.query.execute('human', 17)).resolves.toMatchObject({
        status: 'allowed',
        businessOwnerStatus: kind,
      });
    },
  );
  it.each([
    null,
    { ...ownerMapping, status: 'REVOKED' as const },
    { ...ownerMapping, instanceKey: 'other' },
    { ...ownerMapping, zammadUserId: 7 },
  ])('denies Technician with invalid Owner mapping %#', async (row) => {
    const f = setup();
    f.mappings.findActiveMappingByExternalId.mockResolvedValue(row);
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
  });
  it.each(['INACTIVE', 'IT_ADMIN', 'MISSING'] as const)(
    'denies invalid Owner principal %s',
    async (state) => {
      const f = setup();
      f.iam.getPrincipal
        .mockResolvedValueOnce({
          userId: 'human',
          role: 'TECHNICIAN',
          status: 'ACTIVE',
        })
        .mockResolvedValueOnce(
          state === 'MISSING'
            ? null
            : {
                userId: 'owner',
                role: state === 'IT_ADMIN' ? 'IT_ADMIN' : 'OPERATOR',
                status: state === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
              },
        );
      await expect(f.query.execute('human', 17)).resolves.toEqual({
        status: 'denied',
      });
    },
  );
  it('denies inactive/customer/service/wrong-group Owner when external eligibility fails', async () => {
    const f = setup();
    f.external.getEligibleHuman
      .mockResolvedValueOnce({ externalUserId: 5, groupId: 42 })
      .mockResolvedValueOnce(null);
    await expect(f.query.execute('human', 17)).resolves.toEqual({
      status: 'denied',
    });
  });
  it('permits Operator repair inspection of an unmapped Owner', async () => {
    const f = setup('OPERATOR');
    f.mappings.findActiveMappingByExternalId.mockResolvedValue(null);
    await expect(f.query.execute('human', 17)).resolves.toMatchObject({
      status: 'allowed',
      businessOwnerStatus: 'invalid',
    });
  });
  it('does not convert Owner lookup failure into Operator success', async () => {
    const f = setup('OPERATOR');
    f.mappings.findActiveMappingByExternalId.mockRejectedValue(
      new IdentityMappingError('MAPPING_UNAVAILABLE'),
    );
    await expect(f.query.execute('human', 17)).rejects.toMatchObject({
      code: 'MAPPING_UNAVAILABLE',
    });
  });
  it.each(['external', 'ticket'] as const)(
    'does not authorize on %s dependency failure',
    async (component) => {
      const f = setup();
      (component === 'external'
        ? f.external.getEligibleHuman
        : f.tickets.getTicket
      ).mockRejectedValue(new TicketReadError('UPSTREAM_UNAVAILABLE'));
      await expect(f.query.execute('human', 17)).rejects.toMatchObject({
        code: 'UPSTREAM_UNAVAILABLE',
      });
    },
  );
  it('sanitizes unexpected IAM errors', async () => {
    const f = setup();
    f.iam.getPrincipal.mockRejectedValue(new Error('secret database URL'));
    await expect(f.query.execute('human', 17)).rejects.toThrow(
      'Ticket authorization failed: DEPENDENCY_FAILURE',
    );
  });
  it.each(['assignment', 'owner'] as const)(
    'uses current %s on consecutive requests',
    async (field) => {
      const f = setup();
      const first =
        field === 'owner'
          ? {
              ...ticket,
              nativeOwnerId: 8,
              businessOwner: { kind: 'reference' as const, externalUserId: 5 },
            }
          : ticket;
      f.tickets.getTicket
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce({ ...ticket, nativeOwnerId: 8 });
      expect((await f.query.execute('human', 17)).status).toBe('allowed');
      expect((await f.query.execute('human', 17)).status).toBe('denied');
      expect(f.tickets.getTicket).toHaveBeenCalledTimes(2);
    },
  );
  it.each([0, -1, NaN, 1.5])(
    'rejects invalid Ticket ID %s before any read',
    async (id) => {
      const f = setup();
      await expect(f.query.execute('human', id)).rejects.toMatchObject({
        code: 'INVALID_REQUEST',
      });
      expect(f.iam.getPrincipal.mock.calls).toHaveLength(0);
    },
  );
});
