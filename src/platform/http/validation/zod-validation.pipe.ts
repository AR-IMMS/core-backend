import { createZodValidationPipe } from 'nestjs-zod';

/** Global pipe that validates request DTOs declared with Zod. */
export const CoreZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
});
