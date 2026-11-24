// Starts a private, in-memory replica set created solely for this invocation.
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const {
  copyFileSync,
  cpSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join, resolve } = require('node:path');

const build = process.argv[2] === '--build';
const testImage = build
  ? 'arimms-wf04-ci:local'
  : (process.argv[2] ?? 'arimms-wf04-ci:local');
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const network = 'wf04-ci-' + suffix;
const mongo = network + '-mongo';
const root = resolve(__dirname, '..');
let networkCreated = false;
let mongoCreated = false;

function docker(args, options = {}) {
  const child = spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: options.quiet ? 'ignore' : 'inherit',
    timeout: options.timeout ?? 120000,
  });
  if (child.error || child.status !== 0) {
    if (options.quiet) return false;
    throw new Error(`Docker ${args[0]} failed`);
  }
  return true;
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(description, test) {
  const end = Date.now() + 90000;
  while (Date.now() < end) {
    if (
      docker(['exec', mongo, 'mongosh', '--quiet', '--eval', test], {
        quiet: true,
        timeout: 8000,
      })
    )
      return;
    await pause(1000);
  }
  throw new Error(`Disposable Mongo did not become ${description}`);
}

async function run() {
  if (build) {
    const temp = realpathSync(tmpdir());
    const context = mkdtempSync(join(temp, 'wf04-ci-build-'));
    try {
      for (const file of [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'tsconfig.json',
        'tsconfig.build.json',
        'nest-cli.json',
      ]) {
        copyFileSync(resolve(root, file), resolve(context, file));
      }
      copyFileSync(
        resolve(root, 'deploy/flow04/Dockerfile'),
        resolve(context, 'Dockerfile'),
      );
      cpSync(resolve(root, 'src'), resolve(context, 'src'), {
        recursive: true,
      });
      docker(['build', '-t', testImage, context], { timeout: 600000 });
    } finally {
      const target = realpathSync(context);
      if (
        dirname(target) !== temp ||
        !basename(target).startsWith('wf04-ci-build-')
      )
        throw new Error('Refusing to remove an unexpected build context');
      rmSync(target, { recursive: true });
    }
  }
  docker(['image', 'inspect', '--format', '{{.Id}}', testImage]);
  docker(['network', 'create', '--internal', network]);
  networkCreated = true;
  docker([
    'create',
    '--pull=never',
    '--name',
    mongo,
    '--network',
    network,
    '--network-alias',
    'mongo',
    '--tmpfs',
    '/data/db',
    '--tmpfs',
    '/data/configdb',
    'mongo:8.0',
    'mongod',
    '--replSet',
    'rs0',
    '--bind_ip_all',
  ]);
  mongoCreated = true;
  docker(['start', mongo]);
  await waitFor('available', 'quit(db.adminCommand({ping:1}).ok===1?0:1)');
  docker([
    'exec',
    mongo,
    'mongosh',
    '--quiet',
    '--eval',
    "rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]})",
  ]);
  await waitFor('primary', 'quit(db.hello().isWritablePrimary?0:1)');

  for (const [suite, db] of [
    [
      'ticket-identity-mapping.integration.ts',
      `wf04_ci_${suffix}_mapping_test`,
    ],
    ['ticket-journal.integration.ts', `wf04_ci_${suffix}_journal_test`],
  ]) {
    // Do not consume a caller's MONGODB_TEST_URI or mount the checkout root.
    const uri = `mongodb://mongo:27017/${db}?replicaSet=rs0&directConnection=true`;
    console.log(`WF-04 disposable replica-set suite: ${suite}`);
    docker([
      'run',
      '--rm',
      '--pull=never',
      '--network',
      network,
      '-e',
      'MONGODB_TEST_URI=' + uri,
      '--mount',
      `type=bind,source=${resolve(root, 'test')},target=/app/test,readonly`,
      '--mount',
      `type=bind,source=${resolve(root, 'src')},target=/app/src,readonly`,
      '--entrypoint',
      'node',
      testImage,
      '-r',
      'ts-node/register',
      '-r',
      'tsconfig-paths/register',
      'test/' + suite,
    ]);
  }
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    // Only resources allocated successfully by the current invocation are removed.
    for (const args of [
      ...(mongoCreated ? [['rm', '-f', mongo]] : []),
      ...(networkCreated ? [['network', 'rm', network]] : []),
    ]) {
      try {
        docker(args);
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    }
  });
