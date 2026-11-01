import { Injectable } from '@nestjs/common';
import type { ArgumentMetadata } from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';

const StrictZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
});

/** Validates request DTOs while leaving Nest-injected custom arguments untouched. */
@Injectable()
export class CoreZodValidationPipe extends StrictZodValidationPipe {
  override transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'custom') return value;

    return super.transform(value, metadata);
  }
}
