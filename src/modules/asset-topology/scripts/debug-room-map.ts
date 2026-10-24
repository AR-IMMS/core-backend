import { NestFactory } from '@nestjs/core';
import { CoreModule } from '@/app/core.module';
import { RackQueryUseCase } from '../application/racks/rack-query.use-case';
import { TopologyUseCases } from '../application/topology/topology-use-cases';
import type { RoomId } from '../domain/topology/room';
import { getRoomMapDebugView } from './room-map-debug-view';

async function main(): Promise<void> {
  const roomId = process.argv[2]?.trim();
  if (!roomId) {
    throw new Error('Usage: pnpm asset-topology:debug-room-map -- <room_id>');
  }

  const app = await NestFactory.createApplicationContext(CoreModule, {
    logger: ['error', 'warn'],
  });
  try {
    const rackQueries = app.get(RackQueryUseCase, { strict: false });
    const topology = app.get(TopologyUseCases, { strict: false });
    const output = await getRoomMapDebugView(roomId as RoomId, {
      getRoomMap: (id) => rackQueries.getRoomMap(id),
      getRoom: (id) => topology.getRoom(id),
      getSite: (id) => topology.getSite(id),
      getDefaultDataCenter: () => topology.getDefaultDataCenter(),
    });
    process.stdout.write(`${output}\n`);
  } finally {
    await app.close();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Room map debug failed: ${message}\n`);
  process.exitCode = 1;
});
