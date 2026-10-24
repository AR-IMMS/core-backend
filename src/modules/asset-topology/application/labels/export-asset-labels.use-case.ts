import { Inject, Injectable } from '@nestjs/common';
import type {
  AssetTopologyAssetQueries,
  AssetTopologyRackQueries,
} from '../../contracts';
import {
  ASSET_TOPOLOGY_ASSET_QUERIES_PORT,
  ASSET_TOPOLOGY_RACK_QUERIES_PORT,
} from '../../contracts';
import { QrMappingUseCases } from '../qr/qr-mapping.use-cases';
import type {
  AssetLabelContent,
  LabelDocumentRendererPort,
} from './label-document-renderer.port';
import { LABEL_DOCUMENT_RENDERER } from './label-document-renderer.port';

export type LabelFormat = 'pdf' | 'svg';

export interface ExportAssetLabelsRequest {
  readonly rackIds: readonly string[];
  readonly assetIds: readonly string[];
}

export class LabelExportRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LabelExportRequestError';
  }
}

export class LabelExportTargetNotFoundError extends Error {
  constructor(targetType: 'Asset' | 'Rack', targetId: string) {
    super(`${targetType} ${targetId} was not found`);
    this.name = 'LabelExportTargetNotFoundError';
  }
}

export class LabelExportQrNotFoundError extends Error {
  constructor(targetType: 'Asset' | 'Rack', targetId: string) {
    super(`${targetType} ${targetId} has no active QR mapping`);
    this.name = 'LabelExportQrNotFoundError';
  }
}

@Injectable()
export class ExportAssetLabelsUseCase {
  constructor(
    @Inject(ASSET_TOPOLOGY_ASSET_QUERIES_PORT)
    private readonly assets: AssetTopologyAssetQueries,
    @Inject(ASSET_TOPOLOGY_RACK_QUERIES_PORT)
    private readonly racks: AssetTopologyRackQueries,
    private readonly qrMappings: QrMappingUseCases,
    @Inject(LABEL_DOCUMENT_RENDERER)
    private readonly renderer: LabelDocumentRendererPort,
  ) {}

  async execute(
    request: ExportAssetLabelsRequest,
    format: LabelFormat,
  ): Promise<{
    readonly format: LabelFormat;
    readonly bytes: Uint8Array | string;
  }> {
    const count = request.rackIds.length + request.assetIds.length;
    if (count < 1 || count > 100) {
      throw new LabelExportRequestError('Select between 1 and 100 labels');
    }
    if (
      new Set(request.rackIds).size !== request.rackIds.length ||
      new Set(request.assetIds).size !== request.assetIds.length
    ) {
      throw new LabelExportRequestError('Each target ID may appear only once');
    }

    const labels = [
      ...(await Promise.all(request.rackIds.map((id) => this.rackLabel(id)))),
      ...(await Promise.all(request.assetIds.map((id) => this.assetLabel(id)))),
    ];
    return format === 'pdf'
      ? { format, bytes: await this.renderer.toPdf(labels) }
      : { format, bytes: await this.renderer.toSvg(labels) };
  }

  private async rackLabel(id: string): Promise<AssetLabelContent> {
    const rack = await this.racks.getRack(id as never);
    if (!rack) throw new LabelExportTargetNotFoundError('Rack', id);
    const mapping = await this.qrMappings.getActiveMapping('rack', id);
    if (!mapping) throw new LabelExportQrNotFoundError('Rack', id);
    const location = rack.currentLocation;
    return {
      targetType: 'rack',
      targetId: id,
      qrValue: mapping.value,
      title: `Rack ${id}`,
      detail: location
        ? `Room ${location.roomId} · Column ${location.column} · Row ${location.row}`
        : 'Unplaced',
    };
  }

  private async assetLabel(id: string): Promise<AssetLabelContent> {
    const asset = await this.assets.getAsset(id as never);
    if (!asset) throw new LabelExportTargetNotFoundError('Asset', id);
    const mapping = await this.qrMappings.getActiveMapping('asset', id);
    if (!mapping) throw new LabelExportQrNotFoundError('Asset', id);
    const placement = asset.currentPlacement;
    return {
      targetType: 'asset',
      targetId: id,
      qrValue: mapping.value,
      title: asset.name,
      detail: placement
        ? `Rack ${placement.rackId} · U ${placement.uPosition}`
        : 'Unassigned',
    };
  }
}
