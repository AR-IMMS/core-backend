/* eslint-disable @typescript-eslint/unbound-method -- Jest matchers inspect mocked methods and reflected handlers. */
/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Nest reflection metadata is dynamically typed in this test. */
/* eslint-disable @typescript-eslint/no-unsafe-return -- Nest reflection metadata is dynamically typed in this test. */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { HTTP_ROUTE_POLICY_METADATA } from '@platform/http/api';
import type { TopologyUseCases } from '../../application/topology/topology-use-cases';
import { TopologyResourceNotFoundError } from '../../application/topology/topology-use-cases';
import { Room } from '../../domain/topology/room';
import { RoomMap } from '../../domain/topology/room-map';
import { Site } from '../../domain/topology/site';
import { TopologyController } from '.././topology.controller';

describe('TopologyController', () => {
  const actor = { type: 'user', id: 'admin-1' };
  let useCases: jest.Mocked<TopologyUseCases>;
  let controller: TopologyController;

  beforeEach(() => {
    useCases = {
      getDefaultDataCenter: jest.fn(),
      listSites: jest.fn(),
      createSite: jest.fn(),
      getSite: jest.fn(),
      updateSite: jest.fn(),
      listRooms: jest.fn(),
      createRoom: jest.fn(),
      getRoom: jest.fn(),
      updateRoom: jest.fn(),
    } as unknown as jest.Mocked<TopologyUseCases>;
    controller = new TopologyController(useCases);
  });

  it('returns the read-only default Data Center', async () => {
    useCases.getDefaultDataCenter.mockResolvedValue({
      id: 'dc-default' as never,
      name: 'Default Data Center',
    });

    await expect(controller.getDefaultDataCenter()).resolves.toEqual({
      id: 'dc-default',
      name: 'Default Data Center',
    });
  });

  it('creates a Site beneath the Data Center path and serializes its canonical parent', async () => {
    const site = Site.create({
      id: 'site-1' as never,
      name: 'Building A',
      dataCenterId: 'dc-default' as never,
    });
    useCases.createSite.mockResolvedValue(site);

    await expect(
      controller.createSite(
        { user: { userId: actor.id, role: 'IT_ADMIN' } },
        { data_center_id: 'dc-default' },
        { name: 'Building A' },
      ),
    ).resolves.toEqual({
      id: 'site-1',
      name: 'Building A',
      data_center_id: 'dc-default',
    });
    expect(useCases.createSite).toHaveBeenCalledWith(
      { name: 'Building A', dataCenterId: 'dc-default' },
      actor,
    );
  });

  it('rejects parent fields in Site update requests', async () => {
    await expect(
      controller.updateSite(
        { user: { userId: actor.id, role: 'IT_ADMIN' } },
        { site_id: 'site-1' },
        { name: 'Building B', data_center_id: 'another-dc' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(useCases.updateSite).not.toHaveBeenCalled();
  });

  it('rejects invalid Room dimensions before calling the use case', async () => {
    await expect(
      controller.createRoom(
        { user: { userId: actor.id, role: 'IT_ADMIN' } },
        { site_id: 'site-1' },
        {
          name: 'Server Room A',
          width_mm: 0,
          depth_mm: 8_000,
          grid_snap_mm: 100,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(useCases.createRoom).not.toHaveBeenCalled();
  });

  it('rejects non-Admin mutation even when route permission is granted', async () => {
    useCases.createSite.mockResolvedValue(
      Site.create({
        id: 'site-1' as never,
        name: 'Building A',
        dataCenterId: 'dc-default' as never,
      }),
    );
    await expect(
      controller.createSite(
        { user: { userId: 'operator-1', role: 'OPERATOR' } },
        { data_center_id: 'dc-default' },
        { name: 'Building A' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(useCases.createSite).not.toHaveBeenCalled();
  });

  it('maps a missing resource to the standard HTTP not found exception', async () => {
    useCases.getSite.mockRejectedValue(
      new TopologyResourceNotFoundError('Site'),
    );

    await expect(
      controller.getSite({ site_id: 'site-404' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('assigns read/manage permission policies and exposes no Data Center mutation route', () => {
    expect(policy('getDefaultDataCenter')).toEqual({
      kind: 'permissions',
      permissions: ['asset:read'],
    });
    expect(policy('createSite')).toEqual({
      kind: 'permissions',
      permissions: ['asset:manage'],
    });
    const dataCenterRoutes = Object.getOwnPropertyNames(
      TopologyController.prototype,
    )
      .map((name) => ({
        path: Reflect.getMetadata(
          PATH_METADATA,
          TopologyController.prototype[name as keyof TopologyController],
        ),
        method: Reflect.getMetadata(
          METHOD_METADATA,
          TopologyController.prototype[name as keyof TopologyController],
        ),
      }))
      .filter(
        ({ path }) => typeof path === 'string' && path.includes('data-centers'),
      );
    expect(dataCenterRoutes).toEqual([
      { path: 'data-centers/default', method: 0 },
      { path: 'data-centers/:data_center_id/sites', method: 0 },
      { path: 'data-centers/:data_center_id/sites', method: 1 },
    ]);
  });

  it('serializes a Room map without leaking the domain object', async () => {
    const room = Room.create({
      id: 'room-1' as never,
      name: 'Server Room A',
      siteId: 'site-1' as never,
      roomMap: RoomMap.create({
        widthMm: 10_000,
        depthMm: 8_000,
        gridSnapMm: 100,
      }),
    });
    useCases.getRoom.mockResolvedValue(room);

    await expect(controller.getRoom({ room_id: 'room-1' })).resolves.toEqual({
      id: 'room-1',
      name: 'Server Room A',
      site_id: 'site-1',
      width_mm: 10_000,
      depth_mm: 8_000,
      grid_snap_mm: 100,
    });
  });
});

function policy(handlerName: keyof TopologyController) {
  const handler = TopologyController.prototype[handlerName];
  return new Reflector().getAllAndOverride(HTTP_ROUTE_POLICY_METADATA, [
    handler,
    TopologyController,
  ]);
}
