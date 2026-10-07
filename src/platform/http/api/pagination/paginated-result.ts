import type { Pagination } from './pagination.types';

export class PaginatedResult<T> {
  constructor(
    public readonly items: T[],
    public readonly pagination: Pagination,
  ) {}
}

export function createPaginatedResult<T>(
  items: T[],
  pagination: Pagination,
): PaginatedResult<T> {
  return new PaginatedResult(items, pagination);
}
