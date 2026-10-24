/** Stable public Asset Type codes accepted by the Flow 1 REST API. */
export const ASSET_TYPE_CODES = ['NODE'] as const;
export type AssetTypeCode = (typeof ASSET_TYPE_CODES)[number];

export const ASSET_TYPE_IDS: Readonly<Record<AssetTypeCode, string>> = {
  NODE: 'type-node',
};

const ASSET_TYPE_CODES_BY_ID: Readonly<Record<string, AssetTypeCode>> = {
  'type-node': 'NODE',
};

export function assetTypeIdFromCode(code: AssetTypeCode): string {
  return ASSET_TYPE_IDS[code];
}

export function assetTypeCodeFromId(id: string): AssetTypeCode {
  const code = ASSET_TYPE_CODES_BY_ID[id];
  if (!code) {
    throw new Error(`Asset Type ID "${id}" has no public API mapping.`);
  }
  return code;
}
