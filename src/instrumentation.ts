import { config as loadDotEnv } from 'dotenv';

import { resolveEnvFilePaths } from '@/platform/config';
import { initializeTracing } from './platform/observability/tracing';

loadDotEnv({
  path: resolveEnvFilePaths(),
  override: false,
});

initializeTracing();
