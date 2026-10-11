import type { UnitOfWorkContext } from '../../application/ports/unit-of-work.port';
import type { MongoConnection } from './mongo-connection.types';
import { MongoUnitOfWork } from './mongo-unit-of-work';

describe('MongoUnitOfWork', () => {
  test('passes its MongoDB session as the opaque context and returns after commit', async () => {
    const session = {
      withTransaction: <TResult>(operation: () => Promise<TResult>) =>
        Promise.resolve().then(operation),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      startSession: jest.fn().mockResolvedValue(session),
    } satisfies MongoConnection;
    const unitOfWork = new MongoUnitOfWork(connection);

    const result = await unitOfWork.run(async (context) => {
      expect(context).toBe(session as unknown as UnitOfWorkContext);
      return Promise.resolve('committed');
    });

    expect(result).toBe('committed');
    expect(session.withTransaction).toBeDefined();
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });

  test('ends the session when the producer operation fails', async () => {
    const session = {
      withTransaction: <TResult>(operation: () => Promise<TResult>) =>
        Promise.resolve().then(operation),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const connection = {
      startSession: jest.fn().mockResolvedValue(session),
    } satisfies MongoConnection;
    const unitOfWork = new MongoUnitOfWork(connection);

    await expect(
      unitOfWork.run(() => Promise.reject(new Error('write failed'))),
    ).rejects.toThrow('write failed');
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
