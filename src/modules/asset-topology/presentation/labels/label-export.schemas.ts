import { BadRequestException } from '@nestjs/common';
import { z, ZodError } from 'zod';

const id = z.string().trim().min(1).max(128);

export const labelExportSchema = z
  .strictObject({
    rack_ids: z.array(id).max(100).default([]),
    asset_ids: z.array(id).max(100).default([]),
  })
  .refine((request) => {
    const count = request.rack_ids.length + request.asset_ids.length;
    return count >= 1 && count <= 100;
  }, 'Select between 1 and 100 labels');

export function parseLabelExportRequest(value: unknown) {
  try {
    return labelExportSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BadRequestException({
        message: 'Invalid label export request',
      });
    }
    throw error;
  }
}
