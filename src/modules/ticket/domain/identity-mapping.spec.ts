import { validateIdentityMapping } from './identity-mapping';
const valid = {
  instanceKey: 'p0-1',
  coreUserId: 'core-a',
  zammadUserId: 5,
  approvedGroupId: 2,
  status: 'ACTIVE' as const,
  revision: 1,
  approvedByCoreUserId: 'admin-a',
  approvalReference: 'review-1',
  validatedAt: new Date(),
  createdAt: new Date(0),
  updatedAt: new Date(),
};
describe('identity mapping validation', () => {
  it('preserves explicit IDs without email lookup', () =>
    expect(validateIdentityMapping(valid)).toEqual(valid));
  it('retains revoked records for uniqueness', () =>
    expect(
      validateIdentityMapping({ ...valid, status: 'REVOKED' }).status,
    ).toBe('REVOKED'));
  it.each([
    { coreUserId: '' },
    { coreUserId: ' core-a' },
    { instanceKey: '' },
    { approvedGroupId: 0 },
    { zammadUserId: 1.5 },
    { revision: 0 },
    { status: 'INACTIVE' },
    { validatedAt: new Date('invalid') },
    { approvalReference: '' },
  ])('rejects invalid configuration %#', (patch) => {
    expect(() =>
      validateIdentityMapping({ ...valid, ...patch } as typeof valid),
    ).toThrow('INVALID_MAPPING');
  });
});
