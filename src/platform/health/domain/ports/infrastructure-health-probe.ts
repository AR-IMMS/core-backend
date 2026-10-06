/**
 * Defines the health check capability required from an infrastructure adapter.
 */
export interface InfrastructureHealthProbe {
  readonly key: string;

  check(signal: AbortSignal): Promise<void>;
}
