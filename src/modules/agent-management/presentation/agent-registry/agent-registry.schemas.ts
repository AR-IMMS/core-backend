import { BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z, ZodError } from 'zod';

export const agentRegistryListQuerySchema = z.strictObject({
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
  node_id: z.uuid().optional(),
});

export const agentRegistryBindingsQuerySchema = z.strictObject({
  page_size: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).max(512).optional(),
});

export const agentInstallationParamsSchema = z.strictObject({
  installationId: z.uuid(),
});

export class AgentRegistryListQueryDto extends createZodDto(
  agentRegistryListQuerySchema,
) {}

export class AgentRegistryBindingsQueryDto extends createZodDto(
  agentRegistryBindingsQuerySchema,
) {}

export class AgentInstallationParamsDto extends createZodDto(
  agentInstallationParamsSchema,
) {}

export function parseAgentRegistryRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message: string,
): z.output<TSchema> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) throw new BadRequestException({ message });
    throw error;
  }
}
