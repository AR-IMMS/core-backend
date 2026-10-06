import type { EnvConfig } from './env.schema';

export interface DatabaseConfig {
  mongodb: {
    uri: string | undefined;
    dbName: string;
  };
  postgresql: {
    uri: string | undefined;
    pool: {
      minSize: number;
      maxSize: number;
    };
    connectTimeoutMs: number;
  };
}

/**
 * Maps validated environment variables to the database configuration namespace.
 */
export function createDatabaseConfig(environment: EnvConfig): DatabaseConfig {
  return {
    mongodb: {
      uri: environment.MONGODB_URI,
      dbName: environment.MONGODB_DB_NAME,
    },
    postgresql: {
      uri: environment.POSTGRES_URI,
      pool: {
        minSize: environment.POSTGRES_POOL_MIN_SIZE,
        maxSize: environment.POSTGRES_POOL_MAX_SIZE,
      },
      connectTimeoutMs: environment.POSTGRES_CONNECT_TIMEOUT_MS,
    },
  };
}
