import { Room } from '.././room';
import { RoomMap } from '.././room-map';
import type { SiteId } from '.././site';
import type { RoomId } from '.././room';

describe('Room', () => {
  it('keeps its identity and Site reference when name and map are updated', () => {
    const room = Room.create({
      id: 'room-1' as RoomId,
      name: 'Server Room A',
      siteId: 'site-1' as SiteId,
      roomMap: RoomMap.create({
        widthMm: 10_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      }),
    });

    const updated = room.update({
      name: 'Server Room B',
      roomMap: RoomMap.create({
        widthMm: 12_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      }),
    });

    expect(updated).toMatchObject({
      id: 'room-1',
      name: 'Server Room B',
      siteId: 'site-1',
      roomMap: { widthMm: 12_000, depthMm: 8_000, gridSnapMm: 100 },
    });
    expect(room.name).toBe('Server Room A');
    expect(room.roomMap.widthMm).toBe(10_000);
  });

  it('rejects an empty name', () => {
    expect(() =>
      Room.create({
        id: 'room-1' as RoomId,
        name: '  ',
        siteId: 'site-1' as SiteId,
        roomMap: RoomMap.create({
          widthMm: 1_000,
          depthMm: 1_000,
          gridSnapMm: 50,
        }),
      }),
    ).toThrow('Room name is required');
  });
});
