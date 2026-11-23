import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';
import { MongoFleetEnrollmentOperationStore } from '../mongo-fleet-enrollment-operation.store';

describe('MongoFleetEnrollmentOperationStore', () => {
  const updateOne = jest.fn<
    Promise<{ matchedCount: number }>,
    [
      filter: Record<string, unknown>,
      update: Record<string, unknown>,
      options: { session: UnitOfWorkContext },
    ]
  >();
  const findOne = jest.fn<
    Promise<Record<string, unknown> | null>,
    [filter: Record<string, unknown>, options: { session: UnitOfWorkContext }]
  >();
  const collection = { updateOne, findOne };
  const connection = {
    db: { collection: jest.fn(() => collection) },
  } as unknown as Connection;
  const store = new MongoFleetEnrollmentOperationStore(connection);
  const context = {} as UnitOfWorkContext;
  const input = {
    operationId: 'operation-1',
    invitationId: 'invitation-1',
    status: 'PENDING' as const,
    expiresAt: new Date('2026-11-23T00:00:00Z'),
    updatedAt: new Date('2026-11-22T00:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('reports the first durable invitation mapping so audit is emitted once', async () => {
    updateOne.mockResolvedValueOnce({ matchedCount: 1 });

    await expect(store.recordInvitation(input, context)).resolves.toBe(true);
    expect(updateOne.mock.calls[0]?.[0]).toMatchObject({
      operationId: input.operationId,
      invitationId: { $exists: false },
    });
    expect(updateOne.mock.calls[0]?.[1].$set).toMatchObject({
      invitationId: input.invitationId,
    });
    expect(findOne).not.toHaveBeenCalled();
  });

  test('never reopens a terminal invitation when a stale Fleet retry arrives', async () => {
    updateOne.mockResolvedValueOnce({ matchedCount: 0 });
    findOne.mockResolvedValueOnce({
      operationId: input.operationId,
      invitationId: input.invitationId,
      status: 'CANCELLED',
    });

    await expect(store.recordInvitation(input, context)).resolves.toBe(false);
    expect(updateOne).toHaveBeenCalledTimes(1);
  });

  test('does not claim a second invitation audit when the mapping already exists', async () => {
    updateOne
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 1 });
    findOne.mockResolvedValueOnce({
      operationId: input.operationId,
      invitationId: input.invitationId,
      status: 'INVITATION_ISSUED',
    });

    await expect(store.recordInvitation(input, context)).resolves.toBe(false);
    expect(updateOne).toHaveBeenCalledTimes(2);
  });
});
