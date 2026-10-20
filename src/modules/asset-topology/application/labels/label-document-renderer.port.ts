export interface AssetLabelContent {
  readonly targetType: 'asset' | 'rack';
  readonly targetId: string;
  readonly qrValue: string;
  readonly title: string;
  readonly detail: string;
}

export interface LabelDocumentRendererPort {
  toPdf(labels: readonly AssetLabelContent[]): Promise<Uint8Array>;
  toSvg(labels: readonly AssetLabelContent[]): Promise<string>;
}

export const LABEL_DOCUMENT_RENDERER = Symbol('LABEL_DOCUMENT_RENDERER');
