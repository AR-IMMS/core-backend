import { BadRequestException } from '@nestjs/common';
import { z, ZodError } from 'zod';

const id = z.string().trim().min(1).max(128);
export const assetPlacementParamsSchema = z.strictObject({ asset_id: id });
export const assetPlacementRequestSchema = z.strictObject({
  rack_id: id,
  u_position: z.number().int().positive(),
});

export function parseAssetPlacementRequest<TSchema extends z.ZodType>(
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
