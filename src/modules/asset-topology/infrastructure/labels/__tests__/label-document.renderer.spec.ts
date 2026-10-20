import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { LabelDocumentRenderer } from '../label-document.renderer';

describe('LabelDocumentRenderer', () => {
  const renderer = new LabelDocumentRenderer();
  const label = {
    targetType: 'asset' as const,
    targetId: 'asset-1',
    qrValue: 'opaque-qr-value',
    title: 'Node <Alpha>',
    detail: 'Rack rack-1 · U 7',
  };

  it('creates valid SVG with an encoded QR graphic and escaped readable fields', async () => {
    const svg = await renderer.toSvg([label]);

    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('<path');
    expect(svg).toContain('Node &lt;Alpha&gt;');
    expect(svg).toContain('Rack rack-1 · U 7');
    expect(svg).toContain('asset-1');
  });

  it('creates a loadable PDF with one page per twelve-label sheet', async () => {
    const bytes = await renderer.toPdf([label]);
    const pdf = await PDFDocument.load(bytes);
    const xObjects = pdf
      .getPage(0)
      .node.Resources()
      ?.lookup(PDFName.of('XObject'), PDFDict);

    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.getPageCount()).toBe(1);
    expect(xObjects?.keys()).toHaveLength(1);
  });

  it('starts another printable page after twelve labels', async () => {
    const bytes = await renderer.toPdf(
      Array.from({ length: 13 }, (_, index) => ({
        ...label,
        targetId: `asset-${index}`,
        qrValue: `qr-${index}`,
      })),
    );
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getPageCount()).toBe(2);
  }, 30_000);
});
