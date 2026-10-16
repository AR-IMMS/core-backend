import type { Pagination } from './pagination.types';

/** Marks handler output for conversion into a standard paginated list envelope. */
export class PaginatedResult<T> {
  /** @param items List items to return.
   * @param pagination Pagination metadata matching the selected strategy.
   * @example `new PaginatedResult(items, { type: 'cursor', next_cursor: null })`
   */
  constructor(
    public readonly items: T[],
    public readonly pagination: Pagination,
  ) {}
}

/** Creates the marker value consumed by ApiResponseInterceptor.
 * @param items List items to return.
 * @param pagination Pagination metadata.
 * @returns A result recognized and wrapped by the global response interceptor.
 * @example `createPaginatedResult(items, { type: 'page', page: 1, page_size: 20, has_next: false, has_prev: false })`
 */
export function createPaginatedResult<T>(
  items: T[],
  pagination: Pagination,
): PaginatedResult<T> {
  return new PaginatedResult(items, pagination);
}
