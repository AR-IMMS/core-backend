import { createZodValidationPipe } from 'nestjs-zod';

/**
 * Enforces Zod DTO declarations for request parameters across the application.
 */
export const CoreZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
});
