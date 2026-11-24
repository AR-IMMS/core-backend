import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AssetActor } from '../../application/assets/asset-registration.use-case';
import type { RoleCode } from '@modules/iam';

export interface AssetHttpRequest {
  readonly user: { readonly userId: string; readonly role: RoleCode };
  readonly id?: string;
  readonly requestId?: string;
}

export function requireAssetAdmin(request: AssetHttpRequest): AssetActor {
  if (request.user.role !== 'IT_ADMIN')
    throw new ForbiddenException('Only IT Admins can manage Assets.');
  return {
    type: 'user',
    id: request.user.userId,
    context: request.requestId ? { request_id: request.requestId } : undefined,
  };
}

export function parseIdempotencyKey(
  value: string | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 128 ||
    /[^\x21-\x7e]/.test(normalized)
  ) {
    throw new BadRequestException({ code: 'INVALID_IDEMPOTENCY_KEY' });
  }
  return normalized;
}
