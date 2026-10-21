import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const id = z.string().trim().min(1).max(128);
export const rackIdParamsSchema = z.strictObject({ rack_id: id });
export const rackRoomParamsSchema = z.strictObject({ room_id: id });
export const createRackSchema = z.strictObject({
  column: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
  name: z.string().trim().min(1).max(128),
  u_capacity: z.number().int().positive(),
});
export const updateRackSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(128).optional(),
    u_capacity: z.number().int().positive().optional(),
  })
  .refine(
    (body) => Object.keys(body).length > 0,
    'At least one Rack field is required',
  );
export const moveRackSchema = z.strictObject({
  room_id: id,
  column: z.number().int().nonnegative(),
  row: z.number().int().nonnegative(),
  rotation: z.union([
    z.literal(0),
    z.literal(90),
    z.literal(180),
    z.literal(270),
  ]),
});

export class RackIdParamsDto extends createZodDto(rackIdParamsSchema) {}
export class RackRoomParamsDto extends createZodDto(rackRoomParamsSchema) {}
export class CreateRackRequestDto extends createZodDto(createRackSchema) {}
export class UpdateRackRequestDto extends createZodDto(updateRackSchema) {}
export class MoveRackRequestDto extends createZodDto(moveRackSchema) {}
