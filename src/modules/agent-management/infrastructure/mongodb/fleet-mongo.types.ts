import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';

export interface FleetMongoOperationOptions {
  readonly session?: UnitOfWorkContext;
  readonly projection?: Readonly<Record<string, 0 | 1>>;
}

export interface FleetMongoCollection {
  countDocuments(
    filter: Readonly<Record<string, unknown>>,
    options?: FleetMongoOperationOptions,
  ): Promise<number>;
  createIndex(
    keys: Readonly<Record<string, number>>,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<string>;
  findOne(
    filter: Readonly<Record<string, unknown>>,
    options?: FleetMongoOperationOptions,
  ): Promise<Record<string, unknown> | null>;
  insertOne(
    document: Readonly<Record<string, unknown>>,
    options?: FleetMongoOperationOptions,
  ): Promise<unknown>;
  updateOne(
    filter: Readonly<Record<string, unknown>>,
    update: { readonly $set: Readonly<Record<string, unknown>> },
    options?: FleetMongoOperationOptions,
  ): Promise<{ readonly matchedCount: number }>;
}

export function fleetMongoCollection(
  connection: Connection,
  name: string,
): FleetMongoCollection {
  const database = connection.db as unknown as {
    collection(collectionName: string): FleetMongoCollection;
  };
  return database.collection(name);
}
