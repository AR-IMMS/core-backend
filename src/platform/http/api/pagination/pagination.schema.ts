import { z } from 'zod';

/** Default `page_size` accepted by the shared pagination query schemas. */
export const DEFAULT_PAGE_SIZE = 20;
/** Maximum `page_size` accepted by the shared pagination query schemas. */
export const MAX_PAGE_SIZE = 100;

const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE);

const sortSchema = z.string().trim().min(1).optional();

/** Strict cursor query schema; unknown keys are rejected. */
export const cursorPaginationQuerySchema = z.strictObject({
  page_size: pageSizeSchema,
  cursor: z.string().trim().min(1).optional(),
  sort: sortSchema,
});

/** Strict page query schema; unknown keys are rejected. */
export const pagePaginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: pageSizeSchema,
  sort: sortSchema,
});

/** Parsed cursor query values, including applied defaults. */
export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

/** Parsed page query values, including applied defaults. */
export type PagePaginationQuery = z.infer<typeof pagePaginationQuerySchema>;
