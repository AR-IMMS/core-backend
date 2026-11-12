import { BOOTSTRAP_TOKEN_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/bootstrap-token-indexes.migration';
import { ENROLLMENT_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/enrollment-indexes.migration';
import { ENROLLMENT_RECOVERY_MIGRATION } from './infrastructure/mongodb/migrations/enrollment-recovery.migration';
import { AGENT_ACCESS_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/agent-access-indexes.migration';
import { AGENT_REGISTRY_QUERY_INDEXES_MIGRATION } from './infrastructure/mongodb/migrations/agent-registry-query-indexes.migration';

export const AGENT_MANAGEMENT_MONGO_MIGRATIONS = [
  BOOTSTRAP_TOKEN_INDEXES_MIGRATION,
  ENROLLMENT_INDEXES_MIGRATION,
  ENROLLMENT_RECOVERY_MIGRATION,
  AGENT_ACCESS_INDEXES_MIGRATION,
  AGENT_REGISTRY_QUERY_INDEXES_MIGRATION,
] as const;
