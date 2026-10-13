import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_METADATA = 'api:raw-response';

/** Marks a handler or controller as responsible for its complete HTTP response.
 * @returns Nest metadata decorator.
 * @example `@RawResponse()`
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_METADATA, true);
