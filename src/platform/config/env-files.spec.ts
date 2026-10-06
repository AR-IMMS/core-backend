import { describe, expect, it } from '@jest/globals';

import { resolveEnvFilePaths } from './env-files';

describe('resolveEnvFilePaths', () => {
  it('prioritizes local files for the selected environment', () => {
    expect(resolveEnvFilePaths('test')).toEqual([
      '.env.test.local',
      '.env.local',
      '.env.test',
      '.env',
    ]);
  });

  it('supports staging environment files', () => {
    expect(resolveEnvFilePaths('staging')).toEqual([
      '.env.staging.local',
      '.env.local',
      '.env.staging',
      '.env',
    ]);
  });

  it('falls back to development for an unsupported environment', () => {
    expect(resolveEnvFilePaths('preview')).toEqual([
      '.env.development.local',
      '.env.local',
      '.env.development',
      '.env',
    ]);
  });
});
