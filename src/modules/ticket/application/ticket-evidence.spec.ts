/* eslint-disable @typescript-eslint/require-await -- application port fixture functions */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TicketEvidence,
  evidenceLimit,
  uploadEvidenceSchema,
} from './ticket-evidence';
import {
  TicketJournal,
  TicketOperationError,
  type TicketEvidenceRecord,
} from './ticket-journal';
import type { TicketWorkflow } from './ticket-workflow';
import { PrivateTicketEvidenceFiles } from '../infrastructure/private-ticket-evidence-files';
const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n',
);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMBAQAY3YkAAAAASUVORK5CYII=',
  'base64',
);
const jpeg = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAEAAQDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCiAGKbX//Z',
  'base64',
);
const webp = Buffer.from(
  'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoEAAQAAUAmJaACdLoB+AADsAD+8Skv/M0THMftX//TZv02b9Nm/9MWAAA=',
  'base64',
);
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
const op = { actor: 'operator', key: 'verified-test-key' };
const desc = (
  bytes: Buffer,
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'application/pdf',
  name: string,
) => ({ file_size: bytes.length, mime_type: mime, file_name: name });
describe('protected Ticket Evidence', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wf04-evidence-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  function setup() {
    const items: TicketEvidenceRecord[] = [];
    const access = jest.fn(
      async (actor: string, _ticket: number, write: boolean) => {
        if (actor === 'denied' || (write && actor === 'viewer'))
          throw new TicketOperationError('DENIED');
      },
    );
    const workflow = { evidenceAccess: access } as unknown as TicketWorkflow;
    const store = {
      evidenceById: jest.fn(
        async (_i: string, _g: number, t: number, id: string) =>
          items.find((row) => row.ticketId === t && row.id === id) ?? null,
      ),
      evidenceByHash: jest.fn(
        async (_i: string, _g: number, t: number, hash: string) =>
          items.find((row) => row.ticketId === t && row.sha256 === hash) ??
          null,
      ),
      listEvidence: jest.fn(async (_i: string, _g: number, t: number) =>
        items.filter((row) => row.ticketId === t),
      ),
    };
    const run: TicketJournal['run'] = async (_input, prepare) => {
      const result = await (await prepare())('fixture');
      if (result.evidence) items.push(result.evidence);
      return result;
    };
    return new TicketEvidence(
      workflow,
      store,
      { run } as TicketJournal,
      { instance: 'fixture', group: 2 },
      {
        files: new PrivateTicketEvidenceFiles(directory),
        secret: 'synthetic only, not for deployment',
      },
    );
  }
  it.each([
    [png, desc(png, 'image/png', 'photo.png'), 'inline'],
    [jpeg, desc(jpeg, 'image/jpeg', 'camera.jpg'), 'inline'],
    [webp, desc(webp, 'image/webp', 'camera.webp'), 'inline'],
    [pdf, desc(pdf, 'application/pdf', 'sheet.pdf'), 'attachment'],
  ] as const)(
    'writes, verifies, lists and returns authorized original content',
    async (bytes, file, disposition) => {
      const service = setup();
      const issued = await service.grant(op.actor, 42, file);
      await service.write(op.actor, 42, issued.grant, async () => bytes);
      await service.write(op.actor, 42, issued.grant, async () => bytes);
      const row = await service.finalize(op, 42, issued.grant);
      expect(row).toMatchObject({
        id: issued.upload_id,
        fileSize: bytes.length,
        uploadedByUserId: op.actor,
      });
      await expect(service.list('viewer', 42, '', 20)).resolves.toMatchObject({
        items: [{ id: row.id }],
        next: null,
      });
      const read = await service.access('viewer', 42, row.id, disposition);
      await expect(
        service.content('viewer', 42, row.id, read.grant),
      ).resolves.toMatchObject({ bytes, disposition });
      await expect(
        service.content('denied', 42, row.id, read.grant),
      ).rejects.toMatchObject({ code: 'DENIED' });
      await expect(
        service.content(op.actor, 42, row.id, read.grant),
      ).rejects.toMatchObject({ code: 'DENIED' });
      if (disposition === 'attachment')
        await expect(
          service.access('viewer', 42, row.id, 'inline'),
        ).rejects.toMatchObject({ code: 'INVALID' });
    },
  );
  it('rejects invalid type, size, grant scope, and unsafe paths', async () => {
    const service = setup();
    const issued = await service.grant(
      op.actor,
      42,
      desc(svg, 'image/png', 'wrong.png'),
    );
    await expect(
      service.write(op.actor, 42, issued.grant, async () => svg),
    ).rejects.toMatchObject({ code: 'INVALID_FILE' });
    await expect(
      service.write(op.actor, 42, issued.grant, async () =>
        Buffer.alloc(evidenceLimit + 1),
      ),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(
      service.write(op.actor, 43, issued.grant, async () => svg),
    ).rejects.toMatchObject({ code: 'DENIED' });
    await expect(
      service.grant('viewer', 42, desc(pdf, 'application/pdf', 'x.pdf')),
    ).rejects.toMatchObject({ code: 'DENIED' });
    expect(
      uploadEvidenceSchema.safeParse(
        desc(pdf, 'application/pdf', '../hidden.pdf'),
      ).success,
    ).toBe(false);
  });
  it('recovers an interrupted upload with the same grant and prevents duplicate metadata', async () => {
    const service = setup();
    const file = desc(pdf, 'application/pdf', 'photo.pdf');
    const issued = await service.grant(op.actor, 42, file);
    await expect(
      service.write(op.actor, 42, issued.grant, async () => {
        throw new Error('interrupted');
      }),
    ).rejects.toThrow('interrupted');
    await expect(service.list(op.actor, 42, '', 20)).resolves.toMatchObject({
      items: [],
    });
    await service.write(op.actor, 42, issued.grant, async () => pdf);
    await service.finalize(op, 42, issued.grant);
    const duplicate = await service.grant(op.actor, 42, file);
    await service.write(op.actor, 42, duplicate.grant, async () => pdf);
    await expect(
      service.finalize(
        { ...op, key: 'another-fixture-key' },
        42,
        duplicate.grant,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
