import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const uuid = z.uuid();
const title = z.string().trim().min(1).max(200);
const description = z.string().trim().min(1).max(4000);
const externalReference = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const assetIds = z
  .array(uuid)
  .max(20)
  .refine((ids) => new Set(ids).size === ids.length);
const responsibilities = {
  business_owner_user_id: uuid,
  assignee_user_id: uuid,
};

export const createTicketSchema = z.strictObject({
  title,
  description,
  priority_id: positive,
  ...responsibilities,
  incident_id: externalReference.optional(),
  asset_ids: assetIds.optional(),
  reconcile_ticket_id: positive.optional(),
});
export const draftSchema = z.strictObject({
  draft_id: externalReference,
  revision: externalReference,
  priority_id: positive,
  ...responsibilities,
});
export const responsibilitySchema = z
  .strictObject(responsibilities)
  .partial()
  .refine(
    (value) =>
      value.business_owner_user_id !== undefined ||
      value.assignee_user_id !== undefined,
  );
export const informationSchema = z
  .strictObject({ title, priority_id: positive })
  .partial()
  .refine(
    (value) => value.title !== undefined || value.priority_id !== undefined,
  );
export const transitionSchema = z.strictObject({
  state: z.enum(['OPEN', 'PENDING']),
  pending_until: z.iso.datetime({ offset: true }).optional(),
});
export const articleSchema = z.strictObject({ body: description });
export const closeSchema = z.strictObject({
  outcome: z.string().trim().min(1).max(500),
});
export const reopenSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export const linksSchema = z
  .strictObject({
    incident_id: externalReference.nullable().optional(),
    asset_ids: assetIds.optional(),
  })
  .refine(
    (value) => value.incident_id !== undefined || value.asset_ids !== undefined,
  );

export class CreateTicketDto extends createZodDto(createTicketSchema) {}
export class ReviewedDraftDto extends createZodDto(draftSchema) {}
export class ResponsibilitiesDto extends createZodDto(responsibilitySchema) {}
export class TicketInformationDto extends createZodDto(informationSchema) {}
export class TicketTransitionDto extends createZodDto(transitionSchema) {}
export class TicketArticleDto extends createZodDto(articleSchema) {}
export class CloseTicketDto extends createZodDto(closeSchema) {}
export class ReopenTicketDto extends createZodDto(reopenSchema) {}
export class TicketLinksDto extends createZodDto(linksSchema) {}

const integerQuery = (max: number) =>
  z
    .string()
    .regex(/^[1-9][0-9]{0,15}$/)
    .refine(
      (value) => Number.isSafeInteger(Number(value)) && Number(value) <= max,
    );
export const paginationQuery = {
  cursor: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,32}$/)
    .optional(),
  page_size: integerQuery(25).optional(),
};
export const listTicketSchema = z.strictObject({
  ...paginationQuery,
  state: z.enum(['NEW', 'OPEN', 'PENDING', 'CLOSED']).optional(),
  priority_id: integerQuery(Number.MAX_SAFE_INTEGER).optional(),
  business_owner_user_id: uuid.optional(),
  assignee_user_id: uuid.optional(),
  search: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[\p{L}\p{N} ]+$/u)
    .optional(),
});
export class TicketListQueryDto extends createZodDto(listTicketSchema) {}
export class TicketArticleQueryDto extends createZodDto(
  z.strictObject(paginationQuery),
) {}
