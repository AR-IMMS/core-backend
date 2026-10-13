import type { ApiMeta } from './api-meta';
import type { ListResponse, SingleResponse } from './api-response';
import type { Pagination } from './pagination/pagination.types';

/** Creates the envelope used for one resource.
 * @param data Resource value to expose.
 * @param meta Request metadata.
 * @returns The standard single-resource response.
 * @example `createSingleResponse(asset, createApiMeta(requestId))`
 */
export function createSingleResponse<T>(
  data: T,
  meta: ApiMeta,
): SingleResponse<T> {
  return { data, meta };
}

/** Creates a list envelope and includes pagination only when supplied.
 * @param data Collection items.
 * @param meta Request metadata.
 * @param pagination Optional cursor or page pagination details.
 * @returns The standard list response.
 * @example `createListResponse(items, meta, pagination)`
 */
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
