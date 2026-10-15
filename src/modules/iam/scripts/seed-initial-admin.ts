import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';

import { CoreModule } from '@/app/core.module';
import { UserProvisioningService } from '../application/user-provisioning.service';

async function seedInitialAdmin(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: false,
  });

  try {
    const config = app.get(ConfigService);
    const provisioning = app.get(UserProvisioningService, { strict: false });
    const result = await provisioning.bootstrapInitialAdmin({
      userId: config.get<string>('IAM_BOOTSTRAP_USER_ID'),
      username: config.get<string>('IAM_BOOTSTRAP_USERNAME'),
      email: config.get<string>('IAM_BOOTSTRAP_EMAIL'),
      initialPassword: config.get<string>('IAM_BOOTSTRAP_PASSWORD'),
    });

    process.stdout.write(
      result === 'created'
        ? 'Initial IT Admin created; deliver the configured credential securely and require password change at first login.\n'
        : 'An IT Admin already exists; no changes made.\n',
    );
  } finally {
    await app.close();
  }
}

void seedInitialAdmin().catch(() => {
  process.stderr.write(
    'Initial IT Admin seed failed. Check configuration and database readiness.\n',
  );
  process.exitCode = 1;
});
