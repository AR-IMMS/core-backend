import { LocalProvisioningAuthority } from './local-provisioning-authority';
const admin = '00000000-0000-4000-8000-000000000001';
const human = '00000000-0000-4000-8000-000000000002';
const config = {
  enabled: true,
  environment: 'development',
  administratorId: admin,
  instanceKey: 'poc',
  approvedGroupId: 42,
  approvalReference: 'explicit local approval',
  pairs: [{ coreUserId: human, zammadUserId: 4 }],
};
const request = {
  actorUserId: admin,
  instanceKey: 'poc',
  approvedGroupId: 42,
  coreUserId: human,
  zammadUserId: 4,
};
function actors() {
  return {
    authenticate: jest
      .fn()
      .mockResolvedValue({ userId: admin, role: 'IT_ADMIN', status: 'ACTIVE' }),
  };
}
describe('explicit local provisioning authority', () => {
  it('is disabled by default without authenticating', async () => {
    const a = actors();
    await expect(
      new LocalProvisioningAuthority(undefined, a).authorize(request),
    ).resolves.toBeNull();
    expect(a.authenticate).not.toHaveBeenCalled();
  });
  it('grants only an explicitly approved pair to a freshly authenticated designated actor', async () => {
    const a = actors();
    await expect(
      new LocalProvisioningAuthority(config, a).authorize(request),
    ).resolves.toEqual({
      actorUserId: admin,
      approvalReference: config.approvalReference,
    });
    expect(a.authenticate).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...request, actorUserId: human },
    { ...request, coreUserId: admin },
    { ...request, zammadUserId: 6 },
    { ...request, instanceKey: 'other' },
    { ...request, approvedGroupId: 43 },
  ])('rejects unapproved request %j', async (r) => {
    const a = actors();
    await expect(
      new LocalProvisioningAuthority(config, a).authorize(r),
    ).resolves.toBeNull();
    expect(a.authenticate).not.toHaveBeenCalled();
  });
  it.each([
    { userId: human, role: 'IT_ADMIN', status: 'ACTIVE' },
    { userId: admin, role: 'OPERATOR', status: 'ACTIVE' },
    { userId: admin, role: 'IT_ADMIN', status: 'INACTIVE' },
  ])('rejects authenticated actor mismatch %j', async (actor) => {
    const a = actors();
    a.authenticate.mockResolvedValue(actor);
    await expect(
      new LocalProvisioningAuthority(config, a).authorize(request),
    ).resolves.toBeNull();
  });
  it('does not cache administrator authentication', async () => {
    const a = actors();
    const provider = new LocalProvisioningAuthority(config, a);
    await provider.authorize(request);
    a.authenticate.mockRejectedValue(new Error('expired'));
    await expect(provider.authorize(request)).rejects.toThrow('expired');
    expect(a.authenticate).toHaveBeenCalledTimes(2);
  });
  it.each([
    { ...config, environment: 'production' },
    { ...config, enabled: false },
    { ...config, pairs: [{ coreUserId: admin, zammadUserId: 4 }] },
    { ...config, pairs: [...config.pairs, ...config.pairs] },
  ])('rejects unsafe activation configuration %j', (c) => {
    expect(() => new LocalProvisioningAuthority(c, actors())).toThrow(
      'Invalid local provisioning approval',
    );
  });
});
