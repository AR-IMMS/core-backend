import type { UnitOfWorkContext } from '@platform/events';
import type {
  AssetModelReference,
  AssetTypeReference,
} from '../../domain/asset/asset';

export interface AssetCatalogStorePort {
  findType(
    typeId: string,
    context?: UnitOfWorkContext,
  ): Promise<AssetTypeReference | null>;
  findModel(
    modelId: string,
    context?: UnitOfWorkContext,
  ): Promise<AssetModelReference | null>;
}
