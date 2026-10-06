import { registerAs } from '@nestjs/config';
import 'dotenv/config';

import { getTracingConfig } from './tracing.environment';

export type { TracingConfig } from './tracing.environment';

export default registerAs('tracing', getTracingConfig);
