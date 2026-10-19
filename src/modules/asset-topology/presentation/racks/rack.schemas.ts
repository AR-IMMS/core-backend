import { z } from 'zod';

const id = z.string().trim().min(1).max(128);
const label = z.string().trim().min(1).max(128).nullable().optional();
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
  u_capacity: z.number().int().positive(),
  row_label: label,
  position_in_row: label,
});
export const updateRackSchema = z
  .strictObject({
    u_capacity: z.number().int().positive().optional(),
    row_label: label,
    position_in_row: label,
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
