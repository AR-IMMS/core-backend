import { z } from 'zod';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const pageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .default(DEFAULT_PAGE_SIZE);

const sortSchema = z.string().trim().min(1).optional();

export const cursorPaginationQuerySchema = z.strictObject({
  page_size: pageSizeSchema,
  cursor: z.string().trim().min(1).optional(),
  sort: sortSchema,
});

export const pagePaginationQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).default(1),
  page_size: pageSizeSchema,
  sort: sortSchema,
});

export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

export type PagePaginationQuery = z.infer<typeof pagePaginationQuerySchema>;
