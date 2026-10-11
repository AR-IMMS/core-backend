import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

describe('Platform Events with a MongoDB replica set', () => {
  test('runs integration coverage in a standalone Node process', () => {
    const runnerPath = resolve(__dirname, 'platform-events.integration.ts');
    const result = spawnSync(
      process.execPath,
      [
        '-r',
        require.resolve('ts-node/register'),
        '-r',
        require.resolve('tsconfig-paths/register'),
        runnerPath,
      ],
      {
        cwd: resolve(__dirname, '..'),
        encoding: 'utf8',
        env: {
          ...process.env,
          TS_NODE_TRANSPILE_ONLY: 'true',
          TS_NODE_COMPILER_OPTIONS:
            '{"module":"NodeNext","moduleResolution":"NodeNext"}',
        },
      },
    );

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    expect(result.status).toBe(0);
  }, 60_000);
});
