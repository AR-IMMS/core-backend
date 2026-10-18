import { DomainError } from '../shared/domain-error';
import { Rack } from '../topology/rack';
import { AssetPlacement, StartAssetPlacementProps } from './asset-placement';
import { AssetPlacementPolicy } from './asset-placement-policy';

describe('AssetPlacementPolicy', () => {
  const start = (overrides: Partial<StartAssetPlacementProps> = {}) => ({
    id: 'placement-new',
    assetId: 'asset-1',
    rackId: 'rack-1',
    uPosition: 12,
    placedAt: new Date('2026-01-10T10:00:00.000Z'),
    ...overrides,
  });
  const rack = (id = 'rack-1', uCapacity = 42) =>
    Rack.create({ id, uCapacity });
  const placement = (props: Partial<StartAssetPlacementProps> = {}) =>
    AssetPlacement.start(start(props));

  it('places an unassigned Asset in a valid available Rack U', () => {
    const placed = AssetPlacementPolicy.place(start(), [], [rack()]);

    expect(placed.assetId).toBe('asset-1');
    expect(placed.uPosition.value).toBe(12);
    expect(placed.isActive).toBe(true);
  });

  it('moves an Asset while retaining its closed placement history', () => {
    const prior = placement({
      id: 'placement-old',
      rackId: 'rack-1',
      uPosition: 12,
      placedAt: new Date('2026-01-01T10:00:00.000Z'),
    });

    const result = AssetPlacementPolicy.move(
      prior,
      start({ rackId: 'rack-2', uPosition: 20 }),
      [prior],
      [rack(), rack('rack-2')],
    );

    expect(result.closedPlacement.isActive).toBe(false);
    expect(result.closedPlacement.validTo?.toISOString()).toBe(
      '2026-01-10T10:00:00.000Z',
    );
    expect(result.activePlacement.isActive).toBe(true);
    expect(result.activePlacement.rackId).toBe('rack-2');
    expect(prior.isActive).toBe(true);
  });

  it('unmaps an Asset by closing its placement without changing the Asset', () => {
    const prior = placement({ id: 'placement-old' });

    const closed = AssetPlacementPolicy.unmap(
      prior,
      [prior],
      new Date('2026-01-11T10:00:00.000Z'),
    );

    expect(closed.isActive).toBe(false);
    expect(closed.assetId).toBe(prior.assetId);
    expect(closed.validTo?.toISOString()).toBe('2026-01-11T10:00:00.000Z');
    expect(prior.isActive).toBe(true);
  });

  it('rejects a second active placement for the same Asset', () => {
    const active = placement({ id: 'placement-existing' });

    expect(() =>
      AssetPlacementPolicy.place(start(), [active], [rack()]),
    ).toThrow(DomainError);
  });

  it('rejects an occupied Rack U', () => {
    const active = placement({ id: 'placement-existing' });

    expect(() =>
      AssetPlacementPolicy.place(
        start({ assetId: 'asset-2' }),
        [active],
        [rack()],
      ),
    ).toThrow(DomainError);
  });

  it('rejects a U position above the Rack capacity', () => {
    expect(() =>
      AssetPlacementPolicy.place(start({ uPosition: 43 }), [], [rack()]),
    ).toThrow(DomainError);
  });

  it('keeps the prior active placement unchanged when a move is rejected', () => {
    const prior = placement({
      id: 'placement-old',
      rackId: 'rack-1',
      uPosition: 12,
      placedAt: new Date('2026-01-01T10:00:00.000Z'),
    });
    const destinationOccupant = placement({
      id: 'placement-other',
      assetId: 'asset-2',
      rackId: 'rack-2',
      uPosition: 20,
      placedAt: new Date('2026-01-02T10:00:00.000Z'),
    });

    expect(() =>
      AssetPlacementPolicy.move(
        prior,
        start({ rackId: 'rack-2', uPosition: 20 }),
        [prior, destinationOccupant],
        [rack(), rack('rack-2')],
      ),
    ).toThrow(DomainError);
    expect(prior.isActive).toBe(true);
    expect(prior.validTo).toBeUndefined();
  });
});
