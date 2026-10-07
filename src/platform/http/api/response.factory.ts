import type { ApiMeta } from './api-meta';
import type { ListResponse, SingleResponse } from './api-response';
import type { Pagination } from './pagination/pagination.types';

export function createSingleResponse<T>(
  data: T,
  meta: ApiMeta,
): SingleResponse<T> {
  return { data, meta };
}

export function createListResponse<T>(
  data: T[],
  meta: ApiMeta,
  pagination?: Pagination,
): ListResponse<T> {
  return {
    data,
    meta,
    ...(pagination ? { pagination } : {}),
  };
}
