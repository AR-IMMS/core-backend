import { DomainError } from '../../shared/domain-error';
import { RackMapPlacement } from '../rack-map-placement';
import { RackLocation, StartRackLocationProps } from '../rack-location';
import { RoomMap } from '../room-map';

describe('RackLocation', () => {
  const room = RoomMap.create({
    widthMm: 10_000,
    depthMm: 8_000,
    gridSnapMm: 500,
  });
  const location = (
    overrides: Partial<StartRackLocationProps> = {},
    targetRoomMap = room,
    otherRacks: readonly RackMapPlacement[] = [],
  ) =>
    RackLocation.start(
      {
        rackId: 'rack-1',
        roomId: 'room-1',
        column: 1,
        row: 2,
        rotation: 0,
        locatedAt: new Date('2026-01-01T10:00:00.000Z'),
        ...overrides,
      },
      targetRoomMap,
      otherRacks,
    );

  it('records an initial Rack location with an active interval', () => {
    const current = location();
    expect(current.rackId).toBe('rack-1');
    expect(current.roomId).toBe('room-1');
    expect(current.placement).toMatchObject({ column: 1, row: 2, rotation: 0 });
    expect(current.isActive).toBe(true);
  });

  it('closes the prior location and starts the destination location', () => {
    const current = location();
    const result = current.relocate(
      {
        rackId: 'rack-1',
        roomId: 'room-2',
        column: 3,
        row: 4,
        rotation: 90,
        locatedAt: new Date('2026-01-02T10:00:00.000Z'),
      },
      room,
      [],
    );
    expect(result.closedLocation.validTo?.toISOString()).toBe(
      '2026-01-02T10:00:00.000Z',
    );
    expect(result.activeLocation).toMatchObject({
      roomId: 'room-2',
      placement: { column: 3, row: 4, rotation: 90 },
    });
    expect(current.isActive).toBe(true);
  });

  it('rejects invalid and non-increasing location timestamps', () => {
    expect(() => location({ locatedAt: new Date('invalid') })).toThrow(
      DomainError,
    );
    const current = location();
    expect(() =>
      current.relocate(
        {
          rackId: 'rack-1',
          roomId: 'room-2',
          column: 2,
          row: 2,
          rotation: 0,
          locatedAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        room,
        [],
      ),
    ).toThrow(DomainError);
  });

  it('rejects destination cells outside the generated full-cell grid', () => {
    expect(() => location({ column: 20 })).toThrow(DomainError);
  });

  it('rejects occupied destination cells and preserves the current location', () => {
    const current = location();
    const otherRack = RackMapPlacement.create({
      rackId: 'rack-2',
      column: 3,
      row: 4,
      rotation: 0,
    });
    expect(() =>
      current.relocate(
        {
          rackId: 'rack-1',
          roomId: 'room-2',
          column: 3,
          row: 4,
          rotation: 0,
          locatedAt: new Date('2026-01-02T10:00:00.000Z'),
        },
        room,
        [otherRack],
      ),
    ).toThrow(DomainError);
    expect(current.isActive).toBe(true);
    expect(current.validTo).toBeUndefined();
  });
});
