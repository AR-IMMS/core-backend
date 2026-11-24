import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { CoreModule } from '@/app/core.module';
import { DEFAULT_DATA_CENTER_ID } from '../domain/topology/data-center';
import { buildExampleTopology } from './example-topology';

export async function seedExampleTopology(
  connection: Connection,
): Promise<'created' | 'already-present'> {
  const database = connection.db;
  if (!database) throw new Error('MongoDB connection has no active database');
  const example = buildExampleTopology(new Date());
  const sites = database.collection('asset_topology_sites');
  const rooms = database.collection('asset_topology_rooms');
  const racks = database.collection('asset_topology_racks');
  const locations = database.collection('asset_topology_rack_locations');
  const siteIds = example.sites.map((site) => site.id);
  const roomIds = example.rooms.map((room) => room.id);
  const rackIds = example.racks.map(({ rack }) => rack.id);
  const existing = await Promise.all([
    sites.countDocuments({ id: { $in: siteIds } }),
    rooms.countDocuments({ id: { $in: roomIds } }),
    racks.countDocuments({ id: { $in: rackIds } }),
    locations.countDocuments({ rackId: { $in: rackIds } }),
  ]);
  if (existing.every((count) => count === 0)) {
    // The checks are repeated inside the transaction to catch concurrent runs.
  } else if (
    existing[0] === siteIds.length &&
    existing[1] === roomIds.length &&
    existing[2] === rackIds.length &&
    existing[3] >= rackIds.length
  ) {
    return 'already-present';
  } else {
    throw new Error(
      'Example topology is partially present; resolve its records before seeding',
    );
  }

  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      const dataCenter = await database
        .collection('asset_topology_data_centers')
        .findOne({ id: DEFAULT_DATA_CENTER_ID }, { session });
      if (!dataCenter)
        throw new Error(
          'Default Data Center is missing; run Mongo migrations first',
        );
      const occupied = await Promise.all([
        sites.countDocuments({ id: { $in: siteIds } }, { session }),
        rooms.countDocuments({ id: { $in: roomIds } }, { session }),
        racks.countDocuments({ id: { $in: rackIds } }, { session }),
        locations.countDocuments({ rackId: { $in: rackIds } }, { session }),
      ]);
      if (occupied.some(Boolean))
        throw new Error('Example topology changed during seeding; retry');
      await sites.insertMany(
        example.sites.map((site) => ({
          id: site.id,
          name: site.name,
          dataCenterId: site.dataCenterId,
          auditSequence: 0,
        })),
        { session },
      );
      await rooms.insertMany(
        example.rooms.map((room) => ({
          id: room.id,
          name: room.name,
          siteId: room.siteId,
          widthMm: room.roomMap.widthMm,
          depthMm: room.roomMap.depthMm,
          gridSnapMm: room.roomMap.gridSnapMm,
          walkwayCells: room.roomMap.walkwayCells,
          layoutRevision: 0,
          status: room.status,
          auditSequence: 0,
        })),
        { session },
      );
      await racks.insertMany(
        example.racks.map(({ rack }) => ({
          id: rack.id,
          name: rack.name,
          uCapacity: rack.uCapacity,
          auditSequence: 0,
        })),
        { session },
      );
      await locations.insertMany(
        example.racks.map(({ location }) => ({
          id: `example-location-${location.rackId}`,
          rackId: location.rackId,
          roomId: location.roomId,
          column: location.placement.column,
          row: location.placement.row,
          rotation: location.placement.rotation,
          validFrom: location.validFrom,
        })),
        { session },
      );
    });
    return 'created';
  } finally {
    await session.endSession();
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: ['error', 'warn'],
  });
  try {
    const result = await seedExampleTopology(
      app.get<Connection>(getConnectionToken()),
    );
    process.stdout.write(
      result === 'created'
        ? 'Created example topology: 2 Sites, 3 Rooms, 18 Racks.\n'
        : 'Example topology is already present; no changes made.\n',
    );
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(
      `Example topology seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
