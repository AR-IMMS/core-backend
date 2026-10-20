import { Injectable } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import type {
  AssetLabelContent,
  LabelDocumentRendererPort,
} from '../../application/labels/label-document-renderer.port';

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 24;
const COLUMNS = 3;
const ROWS = 4;
const LABEL_WIDTH = (PAGE_WIDTH - MARGIN * 2) / COLUMNS;
const LABEL_HEIGHT = (PAGE_HEIGHT - MARGIN * 2) / ROWS;
const LABELS_PER_PAGE = COLUMNS * ROWS;

@Injectable()
export class LabelDocumentRenderer implements LabelDocumentRendererPort {
  async toSvg(labels: readonly AssetLabelContent[]): Promise<string> {
    const pages = Math.ceil(labels.length / LABELS_PER_PAGE);
    const height = pages * PAGE_HEIGHT;
    const cells = await Promise.all(
      labels.map(async (label, index) => {
        const x = MARGIN + (index % COLUMNS) * LABEL_WIDTH;
        const y =
          Math.floor(index / LABELS_PER_PAGE) * PAGE_HEIGHT +
          MARGIN +
          Math.floor((index % LABELS_PER_PAGE) / COLUMNS) * LABEL_HEIGHT;
        const qr = await QRCode.toString(label.qrValue, {
          type: 'svg',
          width: 100,
          margin: 1,
          errorCorrectionLevel: 'M',
        });
        const viewBox = qr.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 100 100';
        const inner = qr.match(/<svg[^>]*>([\s\S]*)<\/svg>/)?.[1] ?? '';
        return `<g><rect x="${x}" y="${y}" width="${LABEL_WIDTH}" height="${LABEL_HEIGHT}" fill="white" stroke="#666"/><svg x="${x + 8}" y="${y + 8}" width="100" height="100" viewBox="${viewBox}">${inner}</svg><text x="${x + 116}" y="${y + 40}" font-family="Arial,sans-serif" font-size="14" font-weight="bold">${escapeXml(label.title)}</text><text x="${x + 116}" y="${y + 64}" font-family="Arial,sans-serif" font-size="10">${escapeXml(label.detail)}</text><text x="${x + 116}" y="${y + 86}" font-family="Arial,sans-serif" font-size="8">${escapeXml(label.targetId)}</text></g>`;
      }),
    );
    return `<svg xmlns="http://www.w3.org/2000/svg" width="8.5in" height="${(height / 72).toFixed(2)}in" viewBox="0 0 ${PAGE_WIDTH} ${height}">${cells.join('')}</svg>`;
  }

  async toPdf(labels: readonly AssetLabelContent[]): Promise<Uint8Array> {
    const document = await PDFDocument.create();
    const regular = await document.embedFont(StandardFonts.Helvetica);
    const bold = await document.embedFont(StandardFonts.HelveticaBold);
    for (let start = 0; start < labels.length; start += LABELS_PER_PAGE) {
      const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const pageLabels = labels.slice(start, start + LABELS_PER_PAGE);
      await Promise.all(
        pageLabels.map(async (label, index) => {
          const column = index % COLUMNS;
          const row = Math.floor(index / COLUMNS);
          const x = MARGIN + column * LABEL_WIDTH;
          const top = PAGE_HEIGHT - MARGIN - row * LABEL_HEIGHT;
          const bottom = top - LABEL_HEIGHT;
          const imageBytes = await QRCode.toBuffer(label.qrValue, {
            width: 256,
            margin: 2,
            errorCorrectionLevel: 'M',
          });
          const image = await document.embedPng(imageBytes);
          page.drawRectangle({
            x,
            y: bottom,
            width: LABEL_WIDTH,
            height: LABEL_HEIGHT,
            borderColor: rgb(0.4, 0.4, 0.4),
            borderWidth: 0.5,
          });
          page.drawImage(image, {
            x: x + 8,
            y: bottom + (LABEL_HEIGHT - 100) / 2,
            width: 100,
            height: 100,
          });
          const textX = x + 116;
          const maxWidth = LABEL_WIDTH - 124;
          page.drawText(fitText(label.title, bold, 12, maxWidth), {
            x: textX,
            y: top - 42,
            size: 12,
            font: bold,
            maxWidth,
          });
          page.drawText(fitText(label.detail, regular, 9, maxWidth), {
            x: textX,
            y: top - 62,
            size: 9,
            font: regular,
            maxWidth,
          });
          page.drawText(fitText(label.targetId, regular, 7, maxWidth), {
            x: textX,
            y: top - 80,
            size: 7,
            font: regular,
            maxWidth,
          });
        }),
      );
    }
    return document.save();
  }
}

function fitText(
  text: string,
  font: { widthOfTextAtSize(text: string, size: number): number },
  size: number,
  maxWidth: number,
): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let shortened = text;
  while (
    shortened.length > 1 &&
    font.widthOfTextAtSize(`${shortened}…`, size) > maxWidth
  ) {
    shortened = shortened.slice(0, -1);
  }
  return `${shortened}…`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
