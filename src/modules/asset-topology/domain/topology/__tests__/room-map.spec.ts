import { DomainError } from '../../shared/domain-error';
import { RoomMap } from '../room-map';

describe('RoomMap', () => {
  const dimensions = {
    widthMm: 6_000,
    depthMm: 4_000,
    gridSnapMm: 1_000,
  };

  it('stores only unique full-grid walkway cells in canonical order', () => {
    const roomMap = RoomMap.create({
      ...dimensions,
      walkwayCells: [
        { column: 2, row: 2 },
        { column: 0, row: 1 },
        { column: 1, row: 1 },
      ],
    });

    expect(roomMap.walkwayCells).toEqual([
      { column: 0, row: 1 },
      { column: 1, row: 1 },
      { column: 2, row: 2 },
    ]);
  });

  it('rejects duplicate walkway coordinates', () => {
    expect(() =>
      RoomMap.create({
        ...dimensions,
        walkwayCells: [
          { column: 1, row: 1 },
          { column: 1, row: 1 },
        ],
      }),
    ).toThrow(DomainError);
  });

  it('rejects walkway coordinates outside the generated full-cell grid', () => {
    expect(() =>
      RoomMap.create({
        ...dimensions,
        walkwayCells: [{ column: 6, row: 1 }],
      }),
    ).toThrow(DomainError);
  });
});
