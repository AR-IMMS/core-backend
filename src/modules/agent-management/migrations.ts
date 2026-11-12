import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { ENROLLMENT_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/enrollment-indexes.migration';

export const AGENT_MANAGEMENT_MONGO_MIGRATIONS = [
  BOOTSTRAP_TOKEN_INDEXES_MIGRATION,
  ENROLLMENT_INDEXES_MIGRATION,
] as const;
