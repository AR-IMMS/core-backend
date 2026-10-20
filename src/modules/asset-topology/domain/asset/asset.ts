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
  INVALID_MAINTENANCE_STATE_TRANSITION:
    'ASSET_INVALID_MAINTENANCE_STATE_TRANSITION',
} as const;

export type AssetLifecycleState = 'ACTIVE' | 'MAINTENANCE' | 'RETIRED';

export interface UpdateAssetDescriptionProps {
  readonly name?: string;
  readonly model?: AssetModelReference | null;
  readonly serialNumber?: string | null;
}

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

export interface RestoreAssetProps {
  readonly id: string;
  readonly name: string;
  readonly assetTypeId: string;
  readonly assetModelId?: string;
  readonly serialNumber?: string;
  readonly lifecycleState: AssetLifecycleState;
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
    public readonly lifecycleState: AssetLifecycleState,
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

    return new Asset(
      id,
      name,
      assetTypeId,
      props.model?.id,
      serialNumber,
      'ACTIVE',
    );
  }

  /** Reconstitutes a persisted Asset without applying a lifecycle transition. */
  static restore(props: RestoreAssetProps): Asset {
    const asset = Asset.register({
      id: props.id,
      name: props.name,
      type: { id: props.assetTypeId },
      model: props.assetModelId
        ? { id: props.assetModelId, assetTypeId: props.assetTypeId }
        : undefined,
      serialNumber: props.serialNumber,
    });
    return new Asset(
      asset.id,
      asset.name,
      asset.assetTypeId,
      asset.assetModelId,
      asset.serialNumber,
      props.lifecycleState,
    );
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
      this.lifecycleState,
    );
  }

  /** Updates descriptive fields while preserving canonical identity and Type. */
  updateDescription(props: UpdateAssetDescriptionProps): Asset {
    const name = props.name === undefined ? this.name : props.name.trim();
    if (!name) {
      throw new DomainError(
        AssetErrorCode.NAME_REQUIRED,
        'Asset name is required',
      );
    }
    if (props.model && props.model.assetTypeId !== this.assetTypeId) {
      throw new DomainError(
        AssetErrorCode.MODEL_TYPE_MISMATCH,
        'Asset Model must belong to the Asset Type',
      );
    }

    const assetModelId = Object.hasOwn(props, 'model')
      ? props.model?.id
      : this.assetModelId;
    const serialNumber = Object.hasOwn(props, 'serialNumber')
      ? props.serialNumber?.trim() || undefined
      : this.serialNumber;

    return new Asset(
      this.id,
      name,
      this.assetTypeId,
      assetModelId,
      serialNumber,
      this.lifecycleState,
    );
  }

  /** Changes only the maintenance portion of the lifecycle state. */
  changeMaintenanceState(target: 'ACTIVE' | 'MAINTENANCE'): Asset {
    if (this.lifecycleState === 'RETIRED') {
      throw new DomainError(
        AssetErrorCode.INVALID_MAINTENANCE_STATE_TRANSITION,
        'Retired Assets cannot change maintenance state',
      );
    }
    if (this.lifecycleState === target) return this;

    return new Asset(
      this.id,
      this.name,
      this.assetTypeId,
      this.assetModelId,
      this.serialNumber,
      target,
    );
  }
}
