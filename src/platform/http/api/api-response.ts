import type { ApiMeta } from './api-meta';
import type { Pagination } from './pagination/pagination.types';

export interface SingleResponse<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ListResponse<T> {
  data: T[];
  meta?: ApiMeta;
  pagination?: Pagination;
}
