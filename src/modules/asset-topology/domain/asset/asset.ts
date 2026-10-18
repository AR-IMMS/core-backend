import { DomainError } from '../shared/domain-error';

/**
 * List of error codes defined within the Asset domain.
 * Used to ensure consistency and prevent magic strings across the codebase.
 */
export const AssetErrorCode = {
  ID_REQUIRED: 'ASSET_ID_REQUIRED',
  NAME_REQUIRED: 'ASSET_NAME_REQUIRED',
  TYPE_REQUIRED: 'ASSET_TYPE_REQUIRED',
  MODEL_TYPE_MISMATCH: 'ASSET_MODEL_TYPE_MISMATCH',
} as const;

/**
 * Reference to an Asset Type.
 */
export interface AssetTypeReference {
  readonly id: string;
}

/**
 * Reference to an Asset Model, which belongs to a specific Asset Type.
 */
export interface AssetModelReference {
  readonly id: string;
  readonly assetTypeId: string;
}

/**
 * Properties required to register (initialize) a new Asset.
 */
export interface RegisterAssetProps {
  readonly id: string;
  readonly name: string;
  readonly type: AssetTypeReference;
  readonly model?: AssetModelReference;
  readonly serialNumber?: string;
}

/**
 * Represents the Asset Domain Entity.
 * Contains all business logic and domain invariants for assets.
 */
export class Asset {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly assetTypeId: string,
    public readonly assetModelId: string | undefined,
    public readonly serialNumber: string | undefined,
  ) {}

  /**
   * Registers a new asset based on the provided properties.
   * Validates input data and throws a DomainError if business rules are violated.
   *
   * @param props The properties used to initialize the asset
   * @returns A new instance of Asset
   * @throws {DomainError} If ID, Name, Asset Type is empty, or if the Model does not match the Asset Type
   */
  static register(props: RegisterAssetProps): Asset {
    const id = props.id.trim();
    const name = props.name.trim();
    const assetTypeId = props.type.id.trim();

    if (!id) {
      throw new DomainError(AssetErrorCode.ID_REQUIRED, 'Asset ID is required');
    }

    if (!name) {
      throw new DomainError(
        AssetErrorCode.NAME_REQUIRED,
        'Asset name is required',
      );
    }

    if (!assetTypeId) {
      throw new DomainError(
        AssetErrorCode.TYPE_REQUIRED,
        'Asset Type is required',
      );
    }

    if (props.model && props.model.assetTypeId !== assetTypeId) {
      throw new DomainError(
        AssetErrorCode.MODEL_TYPE_MISMATCH,
        'Asset Model must belong to the Asset Type',
      );
    }

    const serialNumber = props.serialNumber?.trim() || undefined;

    return new Asset(id, name, assetTypeId, props.model?.id, serialNumber);
  }

  /**
   * Renames the current asset.
   *
   * @param name The new name of the asset
   * @returns A new Asset instance with the updated name (Immutability)
   * @throws {DomainError} If the new name is empty
   */
  rename(name: string): Asset {
    const normalizedName = name.trim();

    if (!normalizedName) {
      throw new DomainError(
        AssetErrorCode.NAME_REQUIRED,
        'Asset name is required',
      );
    }

    return new Asset(
      this.id,
      normalizedName,
      this.assetTypeId,
      this.assetModelId,
      this.serialNumber,
    );
  }
}
