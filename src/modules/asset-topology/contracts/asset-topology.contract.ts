import type { AssetLifecycleState } from '../domain/asset/asset';

/** Opaque canonical Asset identity exposed to module consumers. */
export type AssetId = string & { readonly __assetTopologyId: 'AssetId' };

/** Opaque canonical Rack identity exposed to module consumers. */
export type RackId = string & { readonly __assetTopologyId: 'RackId' };

/** Opaque canonical Room identity exposed to module consumers. */
export type RoomId = string & { readonly __assetTopologyId: 'RoomId' };

/** Opaque identity of the seeded Asset Type referenced by an Asset. */
export type AssetTypeId = string & {
  readonly __assetTopologyId: 'AssetTypeId';
};

/** Lifecycle states relevant to Asset consumers. */
export type { AssetLifecycleState } from '../domain/asset/asset';

/** Asset lifecycle states Maintenance may request through its public contract. */
export type AssetTopologyMaintenanceState = 'ACTIVE' | 'MAINTENANCE';

/** Current Rack/U assignment, or `null` when the Asset is unassigned. */
export interface AssetCurrentPlacement {
  readonly rackId: RackId;
  readonly uPosition: number;
}

/** Minimal canonical Asset reference for registry and placement consumers. */
export interface AssetReference {
  readonly id: AssetId;
  readonly name: string;
  readonly assetTypeId: AssetTypeId;
  readonly lifecycleState: AssetLifecycleState;
  readonly currentPlacement: AssetCurrentPlacement | null;
}

/** Independently provided Asset lookup for consumers that do not need topology. */
export interface AssetTopologyAssetQueries {
  getAsset(assetId: AssetId): Promise<AssetReference | null>;
}

/** Current Room-map location of a Rack, or `null` when it has no location. */
export interface RackCurrentLocation {
  readonly roomId: RoomId;
  /** Rack map X coordinate in millimeters. */
  readonly xMm: number;
  /** Rack map Y coordinate in millimeters. */
  readonly yMm: number;
  /** Unrotated Rack width in millimeters. */
  readonly widthMm: number;
  /** Unrotated Rack depth in millimeters. */
  readonly depthMm: number;
  readonly rotation: 0 | 90 | 180 | 270;
}

/** Minimal canonical Rack reference for topology and placement consumers. */
export interface RackReference {
  readonly id: RackId;
  readonly uCapacity: number;
  readonly currentLocation: RackCurrentLocation | null;
}

/** Physical map facts needed to render a Room and its Rack placements. */
export interface RoomMapReference {
  readonly id: RoomId;
  readonly widthMm: number;
  readonly depthMm: number;
  readonly gridSnapMm: number;
}

/** Read-only Asset & Topology queries exposed across module boundaries. */
export interface AssetTopologyQueries extends AssetTopologyAssetQueries {
  getRack(rackId: RackId): Promise<RackReference | null>;
  getRoomMap(roomId: RoomId): Promise<RoomMapReference | null>;
}

/** A request for the Asset-owned maintenance lifecycle transition. */
export interface RequestAssetMaintenanceStateChange {
  readonly assetId: AssetId;
  readonly targetState: AssetTopologyMaintenanceState;
}

/**
 * Validated command boundary used by Maintenance.
 * The implementation validates Asset-owned lifecycle rules; cross-Activity
 * coordination remains an explicit integration decision for AT-13 / AT-05.
 */
export interface AssetTopologyMaintenanceCommands {
  requestMaintenanceStateChange(
    request: RequestAssetMaintenanceStateChange,
  ): Promise<void>;
}

/**
 * Internal module-to-module application contract for Asset & Topology.
 * Keep its provider unbound until Asset and Rack query implementations are
 * complete; Dashboard REST/OpenAPI DTOs do not belong in this contract.
 */
export interface AssetTopologyConsumerContract
  extends AssetTopologyQueries, AssetTopologyMaintenanceCommands {}
