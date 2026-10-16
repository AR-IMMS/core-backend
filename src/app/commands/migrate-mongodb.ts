import { NestFactory } from '@nestjs/core';
import { MongoMigrationCommandModule } from './mongo-migration-command.module';
import { MongoMigrationRunner } from '@platform/database/mongodb/migrations/mongo-migration-runner';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    MongoMigrationCommandModule,
    {
      logger: ['error', 'warn', 'log'],
    },
  );

  try {
    const runner = app.get(MongoMigrationRunner);
    const result = await runner.run();

    console.log(
      `Mongo migrations complete. Applied: ${result.applied.length}; skipped: ${result.skipped.length}.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);

  console.error(`Mongo migration command failed:\n${message}`);
  process.exitCode = 1;
});
