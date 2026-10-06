import { getTracingConfig } from '@/platform/config/tracing.environment';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { MongooseInstrumentation } from '@opentelemetry/instrumentation-mongoose';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

let tracingSdk: NodeSDK | undefined;

/**
 * Initializes OpenTelemetry before Nest loads instrumented dependencies.
 */
export function initializeTracing(): void {
  if (tracingSdk) {
    return;
  }

  const { serviceName, traceEndpoint } = getTracingConfig();

  const sdkOptions = {
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new MongooseInstrumentation(),
    ],
    ...(traceEndpoint
      ? {
          traceExporter: new OTLPTraceExporter({
            url: traceEndpoint,
          }),
        }
      : {}),
  };

  const sdk = new NodeSDK(sdkOptions);
  sdk.start();
  tracingSdk = sdk;
}

/**
 * Flushes buffered spans and stops the OpenTelemetry SDK.
 */
export async function shutdownTracing(): Promise<void> {
  if (!tracingSdk) {
    return;
  }

  const sdk = tracingSdk;
  tracingSdk = undefined;

  await sdk.shutdown();
}
