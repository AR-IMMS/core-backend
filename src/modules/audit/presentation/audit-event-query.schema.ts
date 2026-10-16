import { z } from 'zod';

const filterText = z.string().trim().min(1).max(256);

/** Strict query contract for the Audit event list endpoint. */
export const auditEventListQuerySchema = z
  .object({
    page_size: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().trim().min(1).max(512).optional(),
    occurred_from: z.iso.datetime({ offset: true }).optional(),
    occurred_to: z.iso.datetime({ offset: true }).optional(),
    actor_id: filterText.optional(),
    action: filterText.optional(),
    resource_type: filterText.optional(),
    resource_id: filterText.optional(),
    request_id: filterText.optional(),
  })
  .strict()
  .refine(
    ({ occurred_from, occurred_to }) =>
      !occurred_from ||
      !occurred_to ||
      Date.parse(occurred_from) <= Date.parse(occurred_to),
    { path: ['occurred_to'], message: 'Must be after occurred_from' },
  );

export type AuditEventListQueryDto = z.infer<typeof auditEventListQuerySchema>;
