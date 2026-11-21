import type { HumanAccessPort } from '@modules/iam';
import type { UnitOfWorkContext, UnitOfWorkPort } from '@platform/events';
import {
  ProvisionIdentityMapping,
  type ProvisionMappingRequest,
} from './provision-identity-mapping';

const request: ProvisionMappingRequest = {
  instanceKey: 'test',
  approvedGroupId: 42,
  actorUserId: 'admin',
  coreUserId: 'human',
  zammadUserId: 4,
};
function fixture() {
  const iam: jest.Mocked<HumanAccessPort> = {
    getPrincipal: jest.fn((id) =>
      Promise.resolve({
        userId: id,
        status: 'ACTIVE' as const,
        role: id === 'admin' ? ('IT_ADMIN' as const) : ('OPERATOR' as const),
      }),
    ),
    hasAllPermissions: jest
      .fn<
        ReturnType<HumanAccessPort['hasAllPermissions']>,
        Parameters<HumanAccessPort['hasAllPermissions']>
      >()
      .mockResolvedValue(true),
  };
  const authority = {
    authorize: jest.fn(() =>
      Promise.resolve({
        actorUserId: 'admin',
        approvalReference: 'approved-pair-42',
      }),
    ),
  };
  const external = {
    getEligibleHuman: jest.fn(() =>
      Promise.resolve({ externalUserId: 4, groupId: 42 }),
    ),
  };
  const mappings = { insert: jest.fn(async () => {}) };
  const outbox = { append: jest.fn(async () => {}) };
  const context = {} as UnitOfWorkContext;
  const uow: UnitOfWorkPort = { run: (operation) => operation(context) };
  const useCase = new ProvisionIdentityMapping(
    iam,
    authority,
    external,
    mappings,
    uow,
    outbox,
    request,
  );
  return { iam, authority, external, mappings, outbox, context, useCase };
}
describe('restricted mapping provisioning (unit)', () => {
  it.each(['OPERATOR', 'TECHNICIAN'] as const)(
    'records %s mapping and Audit fact in the same unit of work',
    async (role) => {
      const f = fixture();
      f.iam.getPrincipal.mockImplementation((id) =>
        Promise.resolve({
          userId: id,
          status: 'ACTIVE',
          role: id === 'admin' ? 'IT_ADMIN' : role,
        }),
      );
      const row = await f.useCase.execute(request);
      expect(row).toMatchObject({
        coreUserId: 'human',
        status: 'ACTIVE',
        revision: 1,
        approvedByCoreUserId: 'admin',
      });
      expect(f.mappings.insert).toHaveBeenCalledWith(row, f.context);
      expect(f.outbox.append).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'audit.fact',
          producer: 'ticket',
          payload: {
            actor: { type: 'user', id: 'admin' },
            action: 'ticket.identity_mapping.created',
            changes: [
              { field: 'zammad_user_id', after: 4 },
              { field: 'group_id', after: 42 },
              { field: 'status', after: 'ACTIVE' },
              { field: 'approval_reference', after: 'approved-pair-42' },
            ],
          },
        }),
        f.context,
      );
      expect(f.authority.authorize).toHaveBeenCalledTimes(2);
    },
  );
  it('rejects IT_ADMIN as target even with all inherited permissions', async () => {
    const f = fixture();
    f.iam.getPrincipal.mockImplementation((id) =>
      Promise.resolve({
        userId: id,
        status: 'ACTIVE',
        role: 'IT_ADMIN',
      }),
    );
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.external.getEligibleHuman).not.toHaveBeenCalled();
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it.each([
    'actor-inactive',
    'target-inactive',
    'actor-missing',
    'target-missing',
    'actor-wrong-role',
    'wrong-principal',
    'no-permission',
  ])('fails closed: %s', async (condition) => {
    const f = fixture();
    f.iam.getPrincipal.mockImplementation((id) => {
      if (
        (condition === 'actor-missing' && id === 'admin') ||
        (condition === 'target-missing' && id === 'human')
      )
        return Promise.resolve(null);
      return Promise.resolve({
        userId: condition === 'wrong-principal' ? 'other' : id,
        status:
          (condition === 'actor-inactive' && id === 'admin') ||
          (condition === 'target-inactive' && id === 'human')
            ? 'INACTIVE'
            : 'ACTIVE',
        role:
          id === 'admin'
            ? condition === 'actor-wrong-role'
              ? 'OPERATOR'
              : 'IT_ADMIN'
            : 'TECHNICIAN',
      });
    });
    if (condition === 'no-permission')
      f.iam.hasAllPermissions.mockResolvedValue(false);
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it('requires a grant tied to the actor', async () => {
    const f = fixture();
    f.authority.authorize.mockResolvedValue({
      actorUserId: 'forged',
      approvalReference: 'approval',
    });
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it('rejects absent explicit approval', async () => {
    const f = fixture();
    const authority = { authorize: jest.fn(() => Promise.resolve(null)) };
    const useCase = new ProvisionIdentityMapping(
      f.iam,
      authority,
      f.external,
      f.mappings,
      { run: (op) => op(f.context) },
      f.outbox,
      request,
    );
    await expect(useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.external.getEligibleHuman).not.toHaveBeenCalled();
  });
  it('revalidates IAM after external verification', async () => {
    const f = fixture();
    f.iam.getPrincipal
      .mockResolvedValueOnce({
        userId: 'admin',
        status: 'ACTIVE',
        role: 'IT_ADMIN',
      })
      .mockResolvedValueOnce({
        userId: 'human',
        status: 'ACTIVE',
        role: 'OPERATOR',
      })
      .mockResolvedValueOnce(null);
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it('rejects changed approval after external verification', async () => {
    const f = fixture();
    f.authority.authorize
      .mockResolvedValueOnce({
        actorUserId: 'admin',
        approvalReference: 'first',
      })
      .mockResolvedValueOnce({
        actorUserId: 'admin',
        approvalReference: 'second',
      });
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it.each([
    { groupId: 43, externalUserId: 4 },
    { groupId: 42, externalUserId: 5 },
  ])('rejects mismatched external eligibility %j', async (value) => {
    const f = fixture();
    f.external.getEligibleHuman.mockResolvedValue(value);
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it('sanitizes dependency failures', async () => {
    const f = fixture();
    f.external.getEligibleHuman.mockRejectedValue(
      new Error('secret upstream body'),
    );
    await expect(f.useCase.execute(request)).rejects.toThrow(
      'Mapping provisioning failed: DEPENDENCY_FAILURE',
    );
    expect(f.mappings.insert).not.toHaveBeenCalled();
  });
  it('does not report success when Audit append fails', async () => {
    const f = fixture();
    f.outbox.append.mockRejectedValue(new Error('database details'));
    await expect(f.useCase.execute(request)).rejects.toMatchObject({
      code: 'DEPENDENCY_FAILURE',
    });
  });
  it.each([
    { ...request, instanceKey: 'other' },
    { ...request, approvedGroupId: 43 },
  ])('rejects wrong scope %j', async (input) => {
    const f = fixture();
    await expect(f.useCase.execute(input)).rejects.toMatchObject({
      code: 'DENIED',
    });
    expect(f.authority.authorize).not.toHaveBeenCalled();
  });
  it('rejects invalid external IDs before dependencies', async () => {
    const f = fixture();
    await expect(
      f.useCase.execute({ ...request, zammadUserId: NaN }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(f.iam.getPrincipal.mock.calls).toHaveLength(0);
  });
});
