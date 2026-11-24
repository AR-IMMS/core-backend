import { buildExampleTopology } from '../example-topology';

describe('example topology', () => {
  test('contains two Sites, three Rooms, valid walkways and 18 distinct placed Racks', () => {
    const example = buildExampleTopology(new Date('2026-01-01T00:00:00.000Z'));
    expect(example.sites).toHaveLength(2);
    expect(example.rooms).toHaveLength(3);
    expect(example.racks).toHaveLength(18);
    expect(example.rooms.map((room) => room.siteId)).toEqual([
      example.sites[0].id,
      example.sites[0].id,
      example.sites[1].id,
    ]);
    expect(new Set(example.racks.map(({ rack }) => rack.id)).size).toBe(18);
    for (const room of example.rooms) {
      expect(room.roomMap.walkwayCells.length).toBeGreaterThan(0);
      const placed = example.racks.filter(
        ({ location }) => location.roomId === room.id,
      );
      expect(placed.length).toBeGreaterThan(0);
      expect(placed.length).toBeLessThan(
        room.roomMap.columns * room.roomMap.rows -
          room.roomMap.walkwayCells.length,
      );
      for (const { rack, location } of placed) {
        expect(rack.name).toMatch(/^R-[A-Z]-\d{2}$/);
        expect(location.isActive).toBe(true);
        expect(room.roomMap.walkwayCells).not.toContainEqual({
          column: location.placement.column,
          row: location.placement.row,
        });
      }
    }
    expect(
      new Set(example.racks.map(({ location }) => location.placement.rotation)),
    ).toEqual(new Set([0, 90, 180, 270]));
  });
});
