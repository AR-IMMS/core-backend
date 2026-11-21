import { ZammadUserAccessAdapter } from './zammad-user-access.adapter';
const config = {
  baseUrl: 'http://localhost:8081',
  apiToken: 'unit-secret',
  expectedGroupId: 42,
  timeoutMs: 1000,
};
const service = { id: 6, active: true, group_ids: { '42': ['full'] } };
const human = { id: 4, active: true, group_ids: { '42': ['full'] } };
describe('external user access (unit)', () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  let adapter: ZammadUserAccessAdapter;
  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
    adapter = new ZammadUserAccessAdapter(config, {
      serviceUserId: 6,
      excludedHumanUserIds: [1, 7],
    });
  });
  afterEach(() => jest.restoreAllMocks());
  function reply(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  it('uses exact IDs and direct full access without role IDs, names or email', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(service))
      .mockResolvedValueOnce(
        reply({ ...human, role_ids: [999], email: 'not-a-runtime-key' }),
      );
    await expect(adapter.getEligibleHuman(4)).resolves.toEqual({
      externalUserId: 4,
      groupId: 42,
    });
  });
  it.each([1, 6, 7])(
    'excludes configured non-human identity %s without I/O',
    async (id) => {
      await expect(adapter.getEligibleHuman(id)).resolves.toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, NaN, 1.5])('rejects invalid user ID %s', async (id) => {
    await expect(adapter.getEligibleHuman(id)).rejects.toMatchObject({
      code: 'INVALID_USER_ID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    { ...human, active: false },
    { ...human, group_ids: {} },
    { ...human, group_ids: { '43': ['full'] } },
    { ...human, group_ids: { '42': ['read', 'change'] } },
  ])('denies inactive or ineligible user %j', async (body) => {
    fetchMock
      .mockResolvedValueOnce(reply(service))
      .mockResolvedValueOnce(reply(body));
    await expect(adapter.getEligibleHuman(4)).resolves.toBeNull();
  });
  it.each([
    { ...service, id: 8 },
    { ...service, active: false },
    { ...service, group_ids: {} },
  ])('fails closed on service mismatch %j', async (body) => {
    fetchMock.mockResolvedValueOnce(reply(body));
    await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({
      code: 'SERVICE_IDENTITY_MISMATCH',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...human, id: 5 },
    { ...human, id: '4' },
    { ...human, active: 'true' },
    { ...human, group_ids: [42] },
    { ...human, group_ids: { '42': ['administrator'] } },
    null,
  ])('rejects malformed or wrong identity %j', async (body) => {
    fetchMock
      .mockResolvedValueOnce(reply(service))
      .mockResolvedValueOnce(reply(body));
    await expect(adapter.getEligibleHuman(4)).rejects.toMatchObject({
      code: 'INVALID_UPSTREAM_RESPONSE',
    });
  });
  it('rechecks eligibility on every request', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(service))
      .mockResolvedValueOnce(reply(human))
      .mockResolvedValueOnce(reply(service))
      .mockResolvedValueOnce(reply({ ...human, active: false }));
    expect(await adapter.getEligibleHuman(4)).not.toBeNull();
    expect(await adapter.getEligibleHuman(4)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
