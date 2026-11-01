import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { ENROLLMENT_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/enrollment-indexes.migration';
import { ENROLLMENT_RECOVERY_MIGRATION } from './infrastructure/mongodb/migrations/enrollment-recovery.migration';

export const AGENT_MANAGEMENT_MONGO_MIGRATIONS = [
  BOOTSTRAP_TOKEN_INDEXES_MIGRATION,
  ENROLLMENT_INDEXES_MIGRATION,
  ENROLLMENT_RECOVERY_MIGRATION,
] as const;
