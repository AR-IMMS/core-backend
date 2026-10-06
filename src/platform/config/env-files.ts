export type RuntimeEnvironment =
  'development' | 'test' | 'staging' | 'production';

export function resolveRuntimeEnvironment(
  value: string | undefined,
): RuntimeEnvironment {
  switch (value) {
    case 'test':
    case 'staging':
    case 'production':
      return value;
    case 'development':
    default:
      return 'development';
  }
}

export function resolveEnvFilePaths(
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
): string[] {
  const runtimeEnvironment = resolveRuntimeEnvironment(nodeEnvironment);

  return [
    `.env.${runtimeEnvironment}.local`,
    '.env.local',
    `.env.${runtimeEnvironment}`,
    '.env',
  ];
}
