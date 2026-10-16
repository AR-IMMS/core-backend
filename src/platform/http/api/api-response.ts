import type { ApiMeta } from './api-meta';
import type { Pagination } from './pagination/pagination.types';

/** Standard envelope returned for one resource or a nullable result. */
export interface SingleResponse<T> {
  data: T;
  meta?: ApiMeta;
}

/** Standard envelope returned for a collection, optionally with pagination. */
export interface ListResponse<T> {
  data: T[];
  meta?: ApiMeta;
  pagination?: Pagination;
}
