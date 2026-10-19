import { DomainError } from '../../shared/domain-error';
import { RackMapPlacement } from '../rack-map-placement';
import { RoomMap } from '../room-map';
import { RoomMapChangePolicy } from '../room-map-change-policy';

describe('RoomMapChangePolicy', () => {
  const rack = (column: number, row: number) =>
    RackMapPlacement.create({ rackId: 'rack-1', column, row, rotation: 0 });
  const current = RoomMap.create({
    widthMm: 10_000,
    depthMm: 8_000,
    gridSnapMm: 500,
  });

  it('allows a size change while all cells remain within the proposed grid', () => {
    const proposed = RoomMap.create({
      widthMm: 9_000,
      depthMm: 7_000,
      gridSnapMm: 500,
    });
    expect(() =>
      RoomMapChangePolicy.validate(current, proposed, [rack(10, 10)]),
    ).not.toThrow();
  });

  it('rejects a dimension reduction that pushes a Rack outside the full-cell grid', () => {
    const proposed = RoomMap.create({
      widthMm: 5_000,
      depthMm: 7_000,
      gridSnapMm: 500,
    });
    expect(() =>
      RoomMapChangePolicy.validate(current, proposed, [rack(10, 2)]),
    ).toThrow(DomainError);
  });

  it('rejects a grid-snap change while any Rack is placed', () => {
    const proposed = RoomMap.create({
      widthMm: 10_000,
      depthMm: 8_000,
      gridSnapMm: 250,
    });
    expect(() =>
      RoomMapChangePolicy.validate(current, proposed, [rack(1, 2)]),
    ).toThrow('grid snap cannot change');
  });

  it('allows a grid-snap change when the Room has no placed Racks', () => {
    const proposed = RoomMap.create({
      widthMm: 10_000,
      depthMm: 8_000,
      gridSnapMm: 250,
    });
    expect(() =>
      RoomMapChangePolicy.validate(current, proposed, []),
    ).not.toThrow();
  });

  it('does not mutate supplied Rack placements', () => {
    const placements = [rack(1, 2)];
    const snapshot = { ...placements[0] };
    RoomMapChangePolicy.validate(current, current, placements);
    expect(placements[0]).toEqual(snapshot);
  });
});
