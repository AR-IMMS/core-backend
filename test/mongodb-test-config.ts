export interface MongoTestConfig {
  readonly uri: string;
  readonly dbName: string;
}

/** Validates the dedicated replica-set URI used by integration and e2e tests. */
export function resolveMongoTestConfig(
  uri: string | undefined = process.env.MONGODB_TEST_URI,
): MongoTestConfig {
  if (!uri || uri.trim().length === 0) {
    throw new Error('MONGODB_TEST_URI must be set for MongoDB test suites');
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(uri);
  } catch {
    throw new Error('MONGODB_TEST_URI must be a valid MongoDB URI');
  }

  if (!/^mongodb(?:\+srv)?:$/.test(parsedUri.protocol)) {
    throw new Error('MONGODB_TEST_URI must use mongodb:// or mongodb+srv://');
  }
  if (!parsedUri.searchParams.get('replicaSet')?.trim()) {
    throw new Error('MONGODB_TEST_URI must identify a replica set');
  }

  const dbName = decodeURIComponent(parsedUri.pathname.slice(1));
  if (!dbName.endsWith('_test')) {
    throw new Error('MONGODB_TEST_URI database name must end in _test');
  }

  return { uri, dbName };
}
