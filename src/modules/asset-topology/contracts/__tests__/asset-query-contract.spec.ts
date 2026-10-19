import {
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
  ASSET_TOPOLOGY_RACK_QUERIES_PORT,
  type AssetTopologyAssetQueries,
} from '..';

describe('Asset query contract', () => {
  it('exports an Asset query independently of Rack and Room-map queries', async () => {
    const query: AssetTopologyAssetQueries = {
      getAsset: jest.fn().mockResolvedValue(null),
    };

    expect(ASSET_TOPOLOGY_ASSET_QUERIES_PORT).toBeDefined();
    expect(ASSET_TOPOLOGY_RACK_QUERIES_PORT).toBeDefined();
    await expect(query.getAsset('asset-1' as never)).resolves.toBeNull();
  });
});
