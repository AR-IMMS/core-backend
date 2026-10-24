import { DomainError } from '../../shared/domain-error';
import { RackLayoutPolicy } from '../rack-layout-policy';
import { RackMapPlacement } from '../rack-map-placement';
import { RoomMap } from '../room-map';

describe('RackLayoutPolicy', () => {
  const room = RoomMap.create({
    widthMm: 10_250,
    depthMm: 8_100,
    gridSnapMm: 500,
  });
  const placement = (
    rackId: string,
    column: number,
    row: number,
    rotation: 0 | 90 | 180 | 270 = 0,
  ) => RackMapPlacement.create({ rackId, column, row, rotation });

  it('generates only full Room cells and accepts a free cell', () => {
    expect(room.columns).toBe(20);
    expect(room.rows).toBe(16);
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-1', 19, 15), []),
    ).not.toThrow();
  });

  it('rejects a cell in the partial remainder strip', () => {
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-1', 20, 0), []),
    ).toThrow(DomainError);
  });

  it('rejects negative cell coordinates', () => {
    expect(() => placement('rack-1', -1, 0)).toThrow(DomainError);
  });

  it('rejects an occupied cell, regardless of rotation', () => {
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-2', 2, 3, 90), [
        placement('rack-1', 2, 3),
      ]),
    ).toThrow('Rack cell is already occupied');
  });

  it('rejects a walkway cell even when no Rack occupies it', () => {
    const roomWithWalkway = RoomMap.create({
      widthMm: 10_250,
      depthMm: 8_100,
      gridSnapMm: 500,
      walkwayCells: [{ column: 2, row: 3 }],
    });

    expect(() =>
      RackLayoutPolicy.validate(roomWithWalkway, placement('rack-1', 2, 3), []),
    ).toThrow('walkway');
  });

  it('allows a distinct cell and excludes the same Rack from occupancy checks', () => {
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-2', 3, 3), [
        placement('rack-1', 2, 3),
      ]),
    ).not.toThrow();
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-1', 2, 3), [
        placement('rack-1', 2, 3),
      ]),
    ).not.toThrow();
  });
});
