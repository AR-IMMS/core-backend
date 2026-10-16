import { IAM_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/iam-indexes.migration';

/** IAM-owned MongoDB migrations exposed for registration by the application host. */
export const IAM_MONGO_MIGRATIONS = [IAM_INDEXES_MIGRATION] as const;
