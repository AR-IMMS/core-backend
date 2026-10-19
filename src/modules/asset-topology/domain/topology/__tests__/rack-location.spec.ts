import { DomainError } from '../../shared/domain-error';
import { RackMapPlacement, RackRotation } from '.././rack-map-placement';
import { RackLocation, StartRackLocationProps } from '.././rack-location';
import { RoomMap } from '.././room-map';

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
        xMm: 500,
        yMm: 1_000,
        widthMm: 600,
        depthMm: 1_000,
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
    expect(current.isActive).toBe(true);
    expect(current.validFrom.toISOString()).toBe('2026-01-01T10:00:00.000Z');
  });

  it('retains the prior location when relocating to another Room', () => {
    const current = location();
    const destinationRoom = RoomMap.create({
      widthMm: 6_000,
      depthMm: 5_000,
      gridSnapMm: 500,
    });

    const result = current.relocate(
      {
        rackId: 'rack-1',
        roomId: 'room-2',
        xMm: 1_000,
        yMm: 1_500,
        widthMm: 600,
        depthMm: 1_000,
        rotation: 90,
        locatedAt: new Date('2026-01-02T10:00:00.000Z'),
      },
      destinationRoom,
      [],
    );

    expect(result.closedLocation.isActive).toBe(false);
    expect(result.closedLocation.roomId).toBe('room-1');
    expect(result.closedLocation.validTo?.toISOString()).toBe(
      '2026-01-02T10:00:00.000Z',
    );
    expect(result.activeLocation.isActive).toBe(true);
    expect(result.activeLocation.roomId).toBe('room-2');
    expect(result.activeLocation.placement.rotation).toBe(90);
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
          xMm: 1_000,
          yMm: 1_500,
          widthMm: 600,
          depthMm: 1_000,
          rotation: 0,
          locatedAt: new Date('2026-01-01T10:00:00.000Z'),
        },
        room,
        [],
      ),
    ).toThrow(DomainError);
  });

  it.each([
    {
      scenario: 'outside bounds',
      xMm: 9_500,
      yMm: 1_000,
      rotation: 0,
      otherRacks: [],
    },
    {
      scenario: 'off grid',
      xMm: 750,
      yMm: 1_000,
      rotation: 0,
      otherRacks: [],
    },
    {
      scenario: 'unsupported rotation',
      xMm: 1_000,
      yMm: 1_000,
      rotation: 45,
      otherRacks: [],
    },
    {
      scenario: 'overlap',
      xMm: 1_000,
      yMm: 1_000,
      rotation: 0,
      otherRacks: [
        RackMapPlacement.create({
          rackId: 'rack-2',
          xMm: 1_000,
          yMm: 1_000,
          widthMm: 600,
          depthMm: 1_000,
          rotation: 0,
        }),
      ],
    },
  ] as {
    scenario: string;
    xMm: number;
    yMm: number;
    rotation: number;
    otherRacks: readonly RackMapPlacement[];
  }[])(
    'rejects relocation $scenario and preserves the current active location',
    ({ xMm, yMm, rotation, otherRacks }) => {
      const current = location();

      expect(() =>
        current.relocate(
          {
            rackId: 'rack-1',
            roomId: 'room-2',
            xMm,
            yMm,
            widthMm: 600,
            depthMm: 1_000,
            rotation: rotation as RackRotation,
            locatedAt: new Date('2026-01-02T10:00:00.000Z'),
          },
          room,
          otherRacks,
        ),
      ).toThrow(DomainError);
      expect(current.isActive).toBe(true);
      expect(current.validTo).toBeUndefined();
      expect(current.roomId).toBe('room-1');
    },
  );
});
