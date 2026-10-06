import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const mockSdkLifecycle = {
  start: jest.fn<() => void>(),
  shutdown: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
};

const mockNodeSdkConstructor = jest.fn<
  (configuration: unknown) => typeof mockSdkLifecycle
>(() => mockSdkLifecycle);

const mockTraceExporterConstructor = jest.fn<
  (configuration?: unknown) => object
>(() => ({}));

const mockHttpInstrumentationConstructor = jest.fn<() => object>(() => ({}));
const mockMongooseInstrumentationConstructor = jest.fn<() => object>(
  () => ({}),
);

const mockResourceFromAttributes = jest.fn(
  (attributes: Record<string, string>) => ({ attributes }),
);

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: mockNodeSdkConstructor,
}));

jest.mock('@opentelemetry/exporter-trace-otlp-proto', () => ({
  OTLPTraceExporter: mockTraceExporterConstructor,
}));

jest.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: mockHttpInstrumentationConstructor,
}));

jest.mock('@opentelemetry/instrumentation-mongoose', () => ({
  MongooseInstrumentation: mockMongooseInstrumentationConstructor,
}));

jest.mock('@opentelemetry/resources', () => ({
  resourceFromAttributes: mockResourceFromAttributes,
}));

jest.mock('@opentelemetry/semantic-conventions', () => ({
  ATTR_SERVICE_NAME: 'service.name',
}));

import { initializeTracing, shutdownTracing } from './tracing.sdk';

describe('tracing SDK', () => {
  let originalServiceName: string | undefined;
  let originalTraceEndpoint: string | undefined;

  beforeEach(() => {
    originalServiceName = process.env.OTEL_SERVICE_NAME;
    originalTraceEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

    delete process.env.OTEL_SERVICE_NAME;
    delete process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;

    jest.clearAllMocks();
  });

  afterEach(async () => {
    await shutdownTracing();

    restoreEnvironmentVariable('OTEL_SERVICE_NAME', originalServiceName);
    restoreEnvironmentVariable(
      'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
      originalTraceEndpoint,
    );
  });

  it('initializes the SDK and registers HTTP and Mongoose instrumentation once', () => {
    initializeTracing();
    initializeTracing();

    expect(mockNodeSdkConstructor).toHaveBeenCalledTimes(1);
    expect(mockSdkLifecycle.start).toHaveBeenCalledTimes(1);
    expect(mockHttpInstrumentationConstructor).toHaveBeenCalledTimes(1);
    expect(mockMongooseInstrumentationConstructor).toHaveBeenCalledTimes(1);
    expect(mockResourceFromAttributes).toHaveBeenCalledWith({
      'service.name': 'core-backend',
    });
  });

  it('configures the OTLP exporter with the trace endpoint', () => {
    const endpoint = 'http://127.0.0.1:4318/v1/traces';
    process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = endpoint;

    initializeTracing();

    expect(mockTraceExporterConstructor).toHaveBeenCalledWith({
      url: endpoint,
    });
  });

  it('shuts down the SDK only once', async () => {
    initializeTracing();

    await shutdownTracing();
    await shutdownTracing();

    expect(mockSdkLifecycle.shutdown).toHaveBeenCalledTimes(1);
  });
});

function restoreEnvironmentVariable(
  name: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
