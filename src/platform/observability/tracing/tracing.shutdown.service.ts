import { Injectable, type OnApplicationShutdown } from '@nestjs/common';

import { shutdownTracing } from './tracing.sdk';

/**
 * Connects OpenTelemetry shutdown to the Nest application lifecycle.
 */
@Injectable()
export class TracingShutdownService implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await shutdownTracing();
  }
}
