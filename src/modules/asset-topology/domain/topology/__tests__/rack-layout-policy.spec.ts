import { DomainError } from '../../shared/domain-error';
import { RackLayoutPolicy } from '.././rack-layout-policy';
import { RackMapPlacement } from '.././rack-map-placement';
import { RoomMap } from '.././room-map';

describe('RackLayoutPolicy', () => {
  const room = RoomMap.create({
    widthMm: 10_000,
    depthMm: 8_000,
    gridSnapMm: 500,
  });

  const placement = (
    rackId: string,
    xMm: number,
    yMm: number,
    widthMm = 600,
    depthMm = 1_000,
    rotation: 0 | 90 | 180 | 270 = 0,
  ): RackMapPlacement =>
    RackMapPlacement.create({
      rackId,
      xMm,
      yMm,
      widthMm,
      depthMm,
      rotation,
    });

  it('accepts a Rack inside the Room on the grid', () => {
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-1', 500, 1_000), []),
    ).not.toThrow();
  });

  it('rejects a Rack position that is off the grid', () => {
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-1', 250, 1_000), []),
    ).toThrow(DomainError);
  });

  it('rejects a Rack that extends beyond the Room boundary', () => {
    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-1', 9_500, 1_000), []),
    ).toThrow('Rack footprint must fit inside the Room');
  });

  it('uses the rotated footprint when checking the Room boundary', () => {
    const smallRoom = RoomMap.create({
      widthMm: 1_000,
      depthMm: 600,
      gridSnapMm: 100,
    });

    expect(() =>
      RackLayoutPolicy.validate(
        smallRoom,
        placement('rack-1', 0, 0, 800, 400, 90),
        [],
      ),
    ).toThrow('Rack footprint must fit inside the Room');
  });

  it('rejects overlapping Racks but allows footprints that only touch', () => {
    const existing = placement('rack-1', 0, 0);

    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-2', 500, 0), [existing]),
    ).toThrow('Rack footprints must not overlap');

    expect(() =>
      RackLayoutPolicy.validate(room, placement('rack-2', 1_000, 0), [
        existing,
      ]),
    ).not.toThrow();
  });
});
