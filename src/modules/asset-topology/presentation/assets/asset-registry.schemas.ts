import { BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z, ZodError } from 'zod';

const id = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(128);
export const assetParamsSchema = z.strictObject({ asset_id: id });
export const registerAssetSchema = z.strictObject({
  name,
  asset_type_id: id,
  model_id: id.optional(),
  manufacturer_serial_number: z.string().trim().max(128).optional(),
});
export const updateAssetSchema = z
  .strictObject({
    name: name.optional(),
    model_id: id.nullable().optional(),
    manufacturer_serial_number: z
      .string()
      .trim()
      .max(128)
      .nullable()
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
export const assetListQuerySchema = z.strictObject({
  cursor: z.string().trim().min(1).max(512).optional(),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export class AssetParamsDto extends createZodDto(assetParamsSchema) {}
export class RegisterAssetRequestDto extends createZodDto(
  registerAssetSchema,
) {}
export class UpdateAssetRequestDto extends createZodDto(updateAssetSchema) {}
export class AssetListQueryDto extends createZodDto(assetListQuerySchema) {}

export function parseAssetRequest<TSchema extends z.ZodType>(
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
