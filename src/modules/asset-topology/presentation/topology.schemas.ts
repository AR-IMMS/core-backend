import { BadRequestException } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z, ZodError } from 'zod';

const id = z.string().trim().min(1).max(128);
const name = z.string().trim().min(1).max(128);

export const dataCenterParamsSchema = z.strictObject({ data_center_id: id });
export const siteParamsSchema = z.strictObject({ site_id: id });
export const roomParamsSchema = z.strictObject({ room_id: id });
export const createSiteSchema = z.strictObject({ name });
export const updateSiteSchema = createSiteSchema;
export const createRoomSchema = z.strictObject({
  name,
  width_mm: z.number().int().positive(),
  depth_mm: z.number().int().positive(),
  grid_snap_mm: z.number().int().positive(),
});
export const updateRoomSchema = createRoomSchema;

export class DataCenterParamsDto extends createZodDto(dataCenterParamsSchema) {}
export class SiteParamsDto extends createZodDto(siteParamsSchema) {}
export class RoomParamsDto extends createZodDto(roomParamsSchema) {}
export class CreateSiteRequestDto extends createZodDto(createSiteSchema) {}
export class UpdateSiteRequestDto extends createZodDto(updateSiteSchema) {}
export class CreateRoomRequestDto extends createZodDto(createRoomSchema) {}
export class UpdateRoomRequestDto extends createZodDto(updateRoomSchema) {}

/** Parses an HTTP value and maps Zod failures to the platform's 400 response. */
export function parseTopologyRequest<TSchema extends z.ZodType>(
  schema: TSchema,
  value: unknown,
  message: string,
): z.output<TSchema> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException({ message });
    }
    throw error;
  }
}
