import type { UnitOfWorkContext } from '@platform/events';
import type { ClientSession } from 'mongoose';
import { MongoUserAdministrationStore } from './mongo-user-administration.store';

describe('MongoUserAdministrationStore', () => {
  /** It reads and paginates only safe user fields using a stable user ID cursor. */
  test('lists users after the supplied user ID without selecting credentials', async () => {
    const query = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        {
          userId: 'user-2',
          username: 'Operator',
          email: 'op@example.test',
          normalizedUsername: 'operator',
          normalizedEmail: 'op@example.test',
          displayName: null,
          role: 'OPERATOR',
          status: 'ACTIVE',
          additionalPermissions: [],
          mustChangePassword: true,
          createdAt: new Date('2026-10-16T12:00:00.000Z'),
          updatedAt: new Date('2026-10-16T12:00:00.000Z'),
          auditSequence: 0,
        },
      ]),
    };
    const userModel = {
      find: jest.fn().mockReturnValue(query),
    };
    const store = new MongoUserAdministrationStore(
      userModel as never,
      {} as never,
    );

    await store.listUsers({ afterUserId: 'user-1', limit: 2 });

    expect(userModel.find).toHaveBeenCalledWith({ userId: { $gt: 'user-1' } });
    expect(query.sort).toHaveBeenCalledWith({ userId: 1 });
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(query.select).toHaveBeenCalledWith(
      'userId username email displayName role status additionalPermissions mustChangePassword createdAt updatedAt auditSequence',
    );
  });

  /** A stale sequence cannot update a user or allocate an Audit resource sequence. */
  test('uses the expected sequence in conditional updates', async () => {
    const writeQuery = {
      exec: jest.fn().mockResolvedValue({ matchedCount: 0 }),
    };
    const userModel = {
      updateOne: jest.fn().mockReturnValue(writeQuery),
    };
    const context = {} as UnitOfWorkContext;
    const store = new MongoUserAdministrationStore(
      userModel as never,
      {} as never,
    );

    await expect(
      store.setStatus(
        {
          userId: 'user-2',
          expectedSequence: 7,
          status: 'INACTIVE',
          updatedAt: new Date('2026-10-16T12:00:00.000Z'),
        },
        context,
      ),
    ).resolves.toBeNull();
    expect(userModel.updateOne.mock.calls[0]).toMatchObject([
      { userId: 'user-2', auditSequence: 7 },
      { $set: { status: 'INACTIVE' }, $inc: { auditSequence: 1 } },
      { session: context, timestamps: false },
    ]);
  });

  /** It serializes last-admin changes by incrementing another active admin's guard. */
  test('guards active-admin removal inside the caller transaction', async () => {
    const guardQuery = {
      sort: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue({ userId: 'admin-1' }),
    };
    const writeQuery = {
      exec: jest.fn().mockResolvedValue({ matchedCount: 1 }),
    };
    const userModel = {
      findOne: jest.fn().mockReturnValue(guardQuery),
      updateOne: jest.fn().mockReturnValue(writeQuery),
    };
    const context = {} as UnitOfWorkContext;
    const store = new MongoUserAdministrationStore(
      userModel as never,
      {} as never,
    );

    await expect(store.guardActiveAdminSet('admin-2', context)).resolves.toBe(
      true,
    );

    expect(userModel.findOne).toHaveBeenCalledWith({
      role: 'IT_ADMIN',
      status: 'ACTIVE',
      userId: { $ne: 'admin-2' },
    });
    expect(userModel.updateOne).toHaveBeenCalledWith(
      { userId: 'admin-1', role: 'IT_ADMIN', status: 'ACTIVE' },
      { $inc: { adminGuardVersion: 1 } },
      { session: context as unknown as ClientSession, timestamps: false },
    );
  });
});
