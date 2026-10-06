import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

import type { InfrastructureHealthProbe } from '@platform/health/domain/ports/infrastructure-health-probe';

/**
 * Checks MongoDB connectivity with a lightweight ping command.
 */
@Injectable()
export class MongoHealthProbe implements InfrastructureHealthProbe {
  readonly key = 'mongodb';

  constructor(
    @InjectConnection()
    private readonly connection: Connection,
  ) {}

  async check(signal: AbortSignal): Promise<void> {
    const database = this.connection.db;

    if (!database) {
      throw new Error('MongoDB connection is not available');
    }

    await database.command({ ping: 1 }, { signal });
  }
}
