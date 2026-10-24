import type { UnitOfWorkContext } from '@platform/events';

export type QrTargetType = 'asset' | 'rack';
export interface QrMapping {
  readonly id: string;
  readonly value: string;
  readonly targetType: QrTargetType;
  readonly targetId: string;
  readonly active: boolean;
  readonly validFrom?: Date;
}
export interface QrMappingStorePort {
  getActiveForTarget(
    type: QrTargetType,
    id: string,
    context?: UnitOfWorkContext,
  ): Promise<QrMapping | null>;
  findActiveByValue(value: string): Promise<QrMapping | null>;
  replaceActive(mapping: QrMapping, context: UnitOfWorkContext): Promise<void>;
  deactivateActive(
    type: QrTargetType,
    id: string,
    context: UnitOfWorkContext,
  ): Promise<void>;
}
