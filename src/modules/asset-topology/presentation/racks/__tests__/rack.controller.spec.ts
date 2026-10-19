/* eslint-disable @typescript-eslint/require-await -- Controller dependencies are Promise-returning test doubles. */
import { RackController } from '../rack.controller';

describe('RackController', () => {
  it('returns Room-map cells with the HTTP snake-case contract', async () => {
    const management = {};
    const queries = {
      getRoomMap: jest.fn(async () => ({
        id: 'room-1',
        widthMm: 5_250,
        depthMm: 4_100,
        gridSnapMm: 500,
        columns: 10,
        rows: 8,
        racks: [
          {
            id: 'rack-1',
            uCapacity: 42,
            rowLabel: 'A',
            positionInRow: '03',
            currentLocation: {
              roomId: 'room-1',
              column: 2,
              row: 3,
              rotation: 90,
            },
          },
        ],
      })),
    };
    const controller = new RackController(
      management as never,
      queries as never,
    );

    await expect(controller.getRoomMap({ room_id: 'room-1' })).resolves.toEqual(
      {
        id: 'room-1',
        width_mm: 5_250,
        depth_mm: 4_100,
        grid_snap_mm: 500,
        columns: 10,
        rows: 8,
        racks: [
          {
            id: 'rack-1',
            u_capacity: 42,
            row_label: 'A',
            position_in_row: '03',
            current_location: {
              room_id: 'room-1',
              column: 2,
              row: 3,
              rotation: 90,
            },
          },
        ],
      },
    );
  });

  it('requires an IT Admin role for Rack creation', async () => {
    const controller = new RackController({} as never, {} as never);
    await expect(
      controller.create(
        { user: { userId: 'tech-1', role: 'TECHNICIAN' } },
        { room_id: 'room-1' },
        { column: 0, row: 0, rotation: 0, u_capacity: 42 },
      ),
    ).rejects.toThrow('Only IT Admins can manage Racks.');
  });

  it('returns queryable location history with effective intervals', async () => {
    const controller = new RackController(
      {} as never,
      {
        getRackLocationHistory: jest.fn(() =>
          Promise.resolve([
            {
              roomId: 'room-1',
              column: 2,
              row: 3,
              rotation: 90,
              validFrom: '2026-01-01T00:00:00.000Z',
              validTo: null,
            },
          ]),
        ),
      } as never,
    );

    await expect(
      controller.getLocationHistory({ rack_id: 'rack-1' }),
    ).resolves.toEqual({
      rack_id: 'rack-1',
      locations: [
        {
          room_id: 'room-1',
          column: 2,
          row: 3,
          rotation: 90,
          valid_from: '2026-01-01T00:00:00.000Z',
          valid_to: null,
        },
      ],
    });
  });
});
