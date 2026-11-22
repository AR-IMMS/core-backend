import type { Connection } from 'mongoose';
import type { UnitOfWorkContext } from '@platform/events';

export interface AssetMongoCollection {
  createIndex(
    keys: Readonly<Record<string, number>>,
    options?: Readonly<Record<string, unknown>>,
  ): Promise<string>;
  findOne(
    filter: Readonly<Record<string, unknown>>,
    options?: { readonly session?: UnitOfWorkContext },
  ): Promise<Record<string, unknown> | null>;
  insertOne(document: Readonly<Record<string, unknown>>): Promise<unknown>;
  updateOne(
    filter: Readonly<Record<string, unknown>>,
    update: Readonly<Record<string, unknown>>,
    options?: { readonly session?: UnitOfWorkContext },
  ): Promise<{ readonly matchedCount: number }>;
  find(filter: Readonly<Record<string, unknown>>): {
    sort(value: Record<string, 1 | -1>): {
      limit(count: number): { toArray(): Promise<Record<string, unknown>[]> };
    };
  };
}

export function assetMongoCollection(
  connection: Connection,
  name: string,
): AssetMongoCollection {
  const database = connection.db as unknown as {
    collection(collectionName: string): AssetMongoCollection;
  };
  return database.collection(name);
}
