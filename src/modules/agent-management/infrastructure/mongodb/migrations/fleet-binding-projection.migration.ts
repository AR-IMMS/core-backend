import type { MongoMigration } from '@platform/database/mongodb/migrations';
import { fleetMongoCollection } from '../fleet-mongo.types';

export const FLEET_BINDING_PROJECTION_MIGRATION: MongoMigration = {
  id: '20261122T000100Z_agent_fleet_binding_projection',
  module: 'agent-management',
  description: 'Create unique indexes for Core-owned Fleet Node bindings',
  async up(connection) {
    const bindings = fleetMongoCollection(
      connection,
      'agent_management_fleet_bindings',
    );
    await bindings.createIndex(
      { bindingId: 1 },
      { unique: true, name: 'uq_agent_fleet_binding_id' },
    );
    await bindings.createIndex(
      { invitationId: 1 },
      { unique: true, name: 'uq_agent_fleet_binding_invitation_id' },
    );
    await bindings.createIndex(
      { nodeId: 1 },
      {
        unique: true,
        name: 'uq_agent_fleet_active_binding_node',
        partialFilterExpression: { status: 'active' },
      },
    );
    await bindings.createIndex(
      { installationId: 1 },
      {
        unique: true,
        name: 'uq_agent_fleet_active_binding_installation',
        partialFilterExpression: { status: 'active' },
      },
    );
  },
};
