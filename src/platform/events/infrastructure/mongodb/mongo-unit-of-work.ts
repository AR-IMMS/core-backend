import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';

import type {
  UnitOfWorkContext,
  UnitOfWorkPort,
} from '../../application/ports/unit-of-work.port';
import type { MongoConnection } from './mongo-connection.types';

/** MongoDB implementation of the producer Unit of Work boundary. */
@Injectable()
export class MongoUnitOfWork implements UnitOfWorkPort {
  constructor(
    @InjectConnection() private readonly connection: MongoConnection,
  ) {}

  async run<TResult>(
    operation: (context: UnitOfWorkContext) => Promise<TResult>,
  ): Promise<TResult> {
    const session = await this.connection.startSession();

    try {
      let result!: TResult;
      await session.withTransaction(async () => {
        // The session crosses into application code only as an opaque context.
        result = await operation(session as unknown as UnitOfWorkContext);
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}
