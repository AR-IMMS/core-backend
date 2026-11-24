import { ENROLLMENT_RECOVERY_MIGRATION } from '../enrollment-recovery.migration';

describe('ENROLLMENT_RECOVERY_MIGRATION', () => {
  it('indexes escrow lookup uniquely and expires only escrow data', async () => {
    const indexes: Array<{ keys: object; options: object }> = [];
    const connection = {
      collection: (name: string) => {
        expect(name).toBe('agent_management_enrollment_recovery');
        return {
          createIndex: jest.fn((keys: object, options: object) => {
            indexes.push({ keys, options });
            return Promise.resolve('index');
          }),
        };
      },
    };

    await ENROLLMENT_RECOVERY_MIGRATION.up(connection as never);

    expect(indexes).toEqual([
      expect.objectContaining({
        keys: { attemptId: 1 },
        options: { unique: true, name: 'uq_agent_enrollment_recovery_attempt' },
      }),
      expect.objectContaining({
        keys: { expiresAt: 1 },
        options: {
          expireAfterSeconds: 0,
          name: 'ttl_agent_enrollment_recovery',
        },
      }),
    ]);
  });
});
