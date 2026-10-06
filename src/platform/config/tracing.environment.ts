export interface TracingConfig {
  serviceName: string;
  traceEndpoint?: string;
}

export function getTracingConfig(): TracingConfig {
  return {
    serviceName: process.env.OTEL_SERVICE_NAME?.trim() || 'core-backend',
    traceEndpoint: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim(),
  };
}
