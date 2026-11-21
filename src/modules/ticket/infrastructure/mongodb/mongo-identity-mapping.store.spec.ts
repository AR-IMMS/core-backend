import type { Model } from 'mongoose';
import { MongoIdentityMappingStore } from './mongo-identity-mapping.store';
import type { IdentityMapping } from '../../domain/identity-mapping';
const row: IdentityMapping = {
  instanceKey: 'p0',
  coreUserId: 'a',
  zammadUserId: 5,
  approvedGroupId: 2,
  status: 'ACTIVE',
  revision: 1,
  approvedByCoreUserId: 'admin',
  approvalReference: 'review',
  createdAt: new Date(),
  updatedAt: new Date(),
  validatedAt: new Date(),
};
function setup(results: unknown[][]) {
  const exec = jest.fn();
  for (const result of results) exec.mockResolvedValueOnce(result);
  const query = {
    limit: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec,
  };
  const find = jest.fn().mockReturnValue(query);
  const store = new MongoIdentityMappingStore(
    { find } as unknown as Model<IdentityMapping>,
    { instanceKey: 'p0', approvedGroupId: 2 },
  );
  return { store, find, exec };
}
describe('mapping read fail closed', () => {
  it('rejects ambiguous forward bindings', async () => {
    const { store } = setup([[row, row]]);
    await expect(store.findActiveMapping('a')).rejects.toMatchObject({
      code: 'MAPPING_INTEGRITY',
    });
  });
  it('rejects ambiguous reverse bindings', async () => {
    const { store } = setup([[row], [row, { ...row, coreUserId: 'b' }]]);
    await expect(store.findActiveMapping('a')).rejects.toMatchObject({
      code: 'MAPPING_INTEGRITY',
    });
  });
  it('sanitizes database failures', async () => {
    const { store, exec } = setup([]);
    exec.mockRejectedValue(new Error('sensitive connection string'));
    await expect(store.findActiveMapping('a')).rejects.toMatchObject({
      code: 'MAPPING_UNAVAILABLE',
      message: 'MAPPING_UNAVAILABLE',
    });
  });
  it('rejects invalid lookup before querying', async () => {
    const { store, find } = setup([]);
    await expect(store.findActiveMapping('')).rejects.toThrow();
    expect(find).not.toHaveBeenCalled();
  });
  it('rejects ambiguous Business Owner reverse lookup', async () => {
    const { store } = setup([[row, { ...row, coreUserId: 'b' }]]);
    await expect(store.findActiveMappingByExternalId(5)).rejects.toMatchObject({
      code: 'MAPPING_INTEGRITY',
    });
  });
  it('validates both directions for Business Owner reverse lookup', async () => {
    const { store } = setup([[row], [row], [{ coreUserId: 'a' }]]);
    await expect(store.findActiveMappingByExternalId(5)).resolves.toMatchObject(
      { coreUserId: 'a', zammadUserId: 5 },
    );
  });
  it('rejects invalid reverse identity before querying', async () => {
    const { store, find } = setup([]);
    await expect(store.findActiveMappingByExternalId(0)).rejects.toMatchObject({
      code: 'INVALID_MAPPING',
    });
    expect(find).not.toHaveBeenCalled();
  });
});
