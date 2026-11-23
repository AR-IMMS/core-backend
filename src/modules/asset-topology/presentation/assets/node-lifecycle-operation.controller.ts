import {
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { RequirePermissions } from '@modules/iam';
import {
  NodeLifecycleOperationNotFoundError,
  NodeLifecycleConflictError,
  NodeLifecycleIdempotencyConflictError,
} from '../../application/lifecycle/node-lifecycle.errors';
import { NODE_LIFECYCLE_OPERATION_PORT } from '../../application/lifecycle/node-lifecycle-operation.port';
import type { NodeLifecycleOperationPort } from '../../application/lifecycle/node-lifecycle-operation.port';
import { Inject } from '@nestjs/common';
import { RetireAssetUseCase } from '../../application/assets/retire-asset.use-case';
import { AssetPlacementManagementUseCases } from '../../application/placements/asset-placement-management.use-case';
import { NodeLifecyclePendingError } from '../../application/lifecycle/node-lifecycle-orchestrator';
import { requireAssetAdmin, type AssetHttpRequest } from './asset-http-support';

@Controller('asset-topology/node-lifecycle-operations')
export class NodeLifecycleOperationController {
  constructor(
    @Inject(NODE_LIFECYCLE_OPERATION_PORT)
    private readonly operations: NodeLifecycleOperationPort,
    private readonly retireAsset: RetireAssetUseCase,
    private readonly placements: AssetPlacementManagementUseCases,
  ) {}

  @Get()
  @RequirePermissions('asset:manage')
  async list(
    @Req() request: AssetHttpRequest,
    @Query('limit', new ParseIntPipe({ optional: true })) limit?: number,
  ) {
    requireAssetAdmin(request);
    const boundedLimit = limit ?? 50;
    if (
      !Number.isInteger(boundedLimit) ||
      boundedLimit < 1 ||
      boundedLimit > 100
    )
      throw new ConflictException({ code: 'INVALID_LIMIT' });
    const operations = await this.operations.findPending({
      limit: boundedLimit,
    });
    return { items: operations.map(serializeOperation) };
  }

  @Post(':operation_id/retry')
  @RequirePermissions('asset:manage')
  async retry(
    @Req() request: AssetHttpRequest,
    @Param('operation_id') operationId: string,
  ) {
    const actor = requireAssetAdmin(request);
    const operation = await this.operations.findById(operationId);
    if (!operation)
      throw new NotFoundException({
        code: 'NODE_LIFECYCLE_OPERATION_NOT_FOUND',
      });
    try {
      if (operation.action === 'RETIRE')
        await this.retireAsset.execute(operation.nodeId, actor, {
          operationId,
        });
      else
        await this.placements.unmap(operation.nodeId, actor, { operationId });
      const completed = await this.operations.findById(operationId);
      return serializeOperation(completed ?? operation);
    } catch (error) {
      if (error instanceof NodeLifecyclePendingError)
        throw new ServiceUnavailableException({
          code: 'NODE_LIFECYCLE_PENDING',
          operation_id: error.operationId,
          stage: error.stage,
        });
      if (
        error instanceof NodeLifecycleConflictError ||
        error instanceof NodeLifecycleIdempotencyConflictError
      )
        throw new ConflictException({ code: error.code });
      if (error instanceof NodeLifecycleOperationNotFoundError)
        throw new NotFoundException({
          code: 'NODE_LIFECYCLE_OPERATION_NOT_FOUND',
        });
      throw error;
    }
  }
}

function serializeOperation(
  operation: NonNullable<
    Awaited<ReturnType<NodeLifecycleOperationPort['findById']>>
  >,
) {
  return {
    operation_id: operation.operationId,
    node_id: operation.nodeId,
    action: operation.action,
    stage: operation.stage,
    ...(operation.safeError ? { error_code: operation.safeError } : {}),
    created_at: operation.createdAt.toISOString(),
    updated_at: operation.updatedAt.toISOString(),
  };
}
