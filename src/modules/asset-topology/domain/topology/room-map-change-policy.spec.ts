import { DomainError } from '../shared/domain-error';
import { RackMapPlacement } from './rack-map-placement';
import { RoomMap } from './room-map';
import { RoomMapChangePolicy } from './room-map-change-policy';

describe('RoomMapChangePolicy', () => {
  const rack = (xMm: number, yMm: number) =>
    RackMapPlacement.create({
      rackId: 'rack-1',
      xMm,
      yMm,
      widthMm: 600,
      depthMm: 1_000,
      rotation: 0,
    });

  it('accepts a proposed map that keeps all Racks in bounds and on grid', () => {
    const proposed = RoomMap.create({
      widthMm: 9_000,
      depthMm: 7_000,
      gridSnapMm: 500,
    });

    expect(() =>
      RoomMapChangePolicy.validate(proposed, [rack(1_000, 2_000)]),
    ).not.toThrow();
  });

  it('rejects a dimension reduction that excludes a Rack footprint', () => {
    const proposed = RoomMap.create({
      widthMm: 8_500,
      depthMm: 7_000,
      gridSnapMm: 500,
    });

    expect(() =>
      RoomMapChangePolicy.validate(proposed, [rack(8_000, 2_000)]),
    ).toThrow(DomainError);
  });

  it('rejects a grid change that makes a Rack anchor off-grid', () => {
    const proposed = RoomMap.create({
      widthMm: 9_000,
      depthMm: 7_000,
      gridSnapMm: 500,
    });

    expect(() =>
      RoomMapChangePolicy.validate(proposed, [rack(250, 2_000)]),
    ).toThrow(DomainError);
  });

  it('does not mutate supplied Rack placements', () => {
    const placements = [rack(1_000, 2_000)];
    const snapshot = { ...placements[0] };
    const proposed = RoomMap.create({
      widthMm: 9_000,
      depthMm: 7_000,
      gridSnapMm: 500,
    });

    RoomMapChangePolicy.validate(proposed, placements);

    expect(placements[0]).toEqual(snapshot);
  });
});
