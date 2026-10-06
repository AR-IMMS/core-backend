import type { EnvConfig } from './env.schema';

export type LogLevel = EnvConfig['LOG_LEVEL'];

export interface LoggingConfig {
  level: LogLevel;
}

/**
 * Maps validated environment values to the logging configuration namespace.
 */
export function createLoggingConfig(
  environment: Pick<EnvConfig, 'LOG_LEVEL'>,
): LoggingConfig {
  return {
    level: environment.LOG_LEVEL,
  };
}
