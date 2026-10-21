/* eslint-disable @typescript-eslint/require-await -- Controller dependencies are Promise-returning test doubles. */
import { RackController } from '../rack.controller';

describe('RackController', () => {
  it('returns Room-map cells with the HTTP snake-case contract', async () => {
    const management = {};
    const queries = {
      getRoomMap: jest.fn(async () => ({
        id: 'room-1',
        status: 'ACTIVE',
        widthMm: 5_250,
        depthMm: 4_100,
        gridSnapMm: 500,
        columns: 10,
        rows: 8,
        layoutRevision: 3,
        walkwayCells: [{ column: 0, row: 0 }],
        capacity: {
          totalCells: 80,
          rackCapacityCells: 79,
          activeRackCount: 1,
          freeRackCells: 78,
        },
        racks: [
          {
            id: 'rack-1',
            name: 'Core Rack',
            uCapacity: 42,
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
    const response = { setHeader: jest.fn() };

    await expect(
      controller.getRoomMap({ room_id: 'room-1' }, response),
    ).resolves.toEqual({
      id: 'room-1',
      status: 'ACTIVE',
      width_mm: 5_250,
      depth_mm: 4_100,
      grid_snap_mm: 500,
      grid: { columns: 10, rows: 8, origin: 'lower-left' },
      layout_revision: 3,
      walkway_cells: [{ column: 0, row: 0 }],
      capacity: {
        total_cells: 80,
        rack_capacity_cells: 79,
        active_rack_count: 1,
        free_rack_cells: 78,
      },
      racks: [
        {
          rack_id: 'rack-1',
          name: 'Core Rack',
          column: 2,
          row: 3,
          rotation: 90,
          u_capacity: 42,
          location_label: 'D-3',
        },
      ],
    });
    expect(response.setHeader).toHaveBeenCalledWith('ETag', '"3"');
  });

  it('requires an IT Admin role for Rack creation', async () => {
    const controller = new RackController({} as never, {} as never);
    await expect(
      controller.create(
        { user: { userId: 'tech-1', role: 'TECHNICIAN' } },
        { room_id: 'room-1' },
        {
          name: 'Core Rack',
          column: 0,
          row: 0,
          rotation: 0,
          u_capacity: 42,
        },
      ),
    ).rejects.toThrow('Only IT Admins can manage Racks.');
  });

  it('accepts a required name and includes it in the Rack creation response', async () => {
    const management = {
      create: jest.fn(async () => ({
        value: { id: 'rack-1' },
        layoutRevisions: [{ roomId: 'room-1', revision: 1 }],
      })),
    };
    const queries = {
      getRack: jest.fn(async () => ({
        id: 'rack-1',
        name: 'Core Rack',
        uCapacity: 42,
        currentLocation: {
          roomId: 'room-1',
          column: 3,
          row: 3,
          rotation: 0,
        },
      })),
    };
    const controller = new RackController(
      management as never,
      queries as never,
    );
    const response = { setHeader: jest.fn() };

    await expect(
      controller.create(
        {
          user: { userId: 'admin-1', role: 'IT_ADMIN' },
          headers: { 'if-match': '"0"' },
        },
        { room_id: 'room-1' },
        {
          name: 'Core Rack',
          column: 3,
          row: 3,
          rotation: 0,
          u_capacity: 42,
        },
        response,
      ),
    ).resolves.toEqual({
      id: 'rack-1',
      name: 'Core Rack',
      u_capacity: 42,
      location_label: 'D-4',
      current_location: {
        room_id: 'room-1',
        column: 3,
        row: 3,
        rotation: 0,
      },
      layout_revisions: [{ room_id: 'room-1', revision: 1 }],
    });
    expect(management.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Core Rack' }),
      { type: 'user', id: 'admin-1' },
    );
    expect(response.setHeader).toHaveBeenCalledWith('ETag', '"1"');
  });

  it('formats Room-map row labels beyond Z', async () => {
    const controller = new RackController(
      {} as never,
      {
        getRoomMap: jest.fn(async () => ({
          id: 'room-1',
          widthMm: 1_000,
          depthMm: 27_000,
          gridSnapMm: 1_000,
          columns: 1,
          rows: 27,
          layoutRevision: 1,
          walkwayCells: [],
          capacity: {
            totalCells: 27,
            rackCapacityCells: 27,
            activeRackCount: 1,
            freeRackCells: 26,
          },
          racks: [
            {
              id: 'rack-1',
              name: 'Core Rack',
              uCapacity: 42,
              currentLocation: {
                roomId: 'room-1',
                column: 0,
                row: 26,
                rotation: 0,
              },
            },
          ],
        })),
      } as never,
    );

    await expect(
      controller.getRoomMap({ room_id: 'room-1' }),
    ).resolves.toMatchObject({
      racks: [{ name: 'Core Rack', location_label: 'AA-1' }],
    });
  });

  it('includes a coordinate-derived location label in Rack reads', async () => {
    const controller = new RackController(
      {} as never,
      {
        getRack: jest.fn(async () => ({
          id: 'rack-1',
          name: 'Core Rack',
          uCapacity: 42,
          currentLocation: {
            roomId: 'room-1',
            column: 3,
            row: 3,
            rotation: 0,
          },
        })),
      } as never,
    );

    await expect(controller.get({ rack_id: 'rack-1' })).resolves.toEqual({
      id: 'rack-1',
      name: 'Core Rack',
      u_capacity: 42,
      location_label: 'D-4',
      current_location: {
        room_id: 'room-1',
        column: 3,
        row: 3,
        rotation: 0,
      },
    });
  });

  it('returns a null location label for an unplaced Rack', async () => {
    const controller = new RackController(
      {} as never,
      {
        getRack: jest.fn(async () => ({
          id: 'rack-1',
          name: 'Core Rack',
          uCapacity: 42,
          currentLocation: null,
        })),
      } as never,
    );

    await expect(controller.get({ rack_id: 'rack-1' })).resolves.toMatchObject({
      name: 'Core Rack',
      location_label: null,
      current_location: null,
    });
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
