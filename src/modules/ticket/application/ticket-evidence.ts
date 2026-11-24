import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto';
import { z } from 'zod';
import {
  TicketJournal,
  TicketOperationError,
  type TicketEvidenceRecord,
} from './ticket-journal';
import { TicketWorkflow, type TicketActorOperation } from './ticket-workflow';
import { notificationFor } from './ticket-notifications';

export const evidenceLimit = 8 * 1024 * 1024;
export const evidenceMime = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
]);
const upload = z.strictObject({
  file_name: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((name) =>
      Array.from(name).every(
        (c) =>
          c !== '/' &&
          c !== '\\' &&
          c.charCodeAt(0) >= 32 &&
          c.charCodeAt(0) !== 127,
      ),
    )
    .refine((name) => !['.', '..'].includes(name)),
  mime_type: evidenceMime,
  file_size: z.number().int().positive().max(evidenceLimit),
});
export const uploadEvidenceSchema = upload;
const bound = z.object({
  instance: z.string(),
  group: z.number().int(),
  ticket: z.number().int(),
  actor: z.string(),
  id: z.uuid(),
  exp: z.number().int(),
});
const claimSchema = z.discriminatedUnion('kind', [
  bound.extend({ kind: z.literal('upload'), file: upload }),
  bound.extend({
    kind: z.literal('read'),
    disposition: z.enum(['inline', 'attachment']),
  }),
]);
type Claim = z.infer<typeof claimSchema>;
type Upload = z.infer<typeof upload>;
export interface TicketEvidenceFiles {
  put(key: string, bytes: Buffer): Promise<void>;
  read(key: string): Promise<Buffer | null>;
}
export interface TicketEvidenceStore {
  evidenceById(
    instance: string,
    group: number,
    ticketId: number,
    id: string,
  ): Promise<TicketEvidenceRecord | null>;
  evidenceByHash(
    instance: string,
    group: number,
    ticketId: number,
    hash: string,
  ): Promise<TicketEvidenceRecord | null>;
  listEvidence(
    instance: string,
    group: number,
    ticketId: number,
    after: string,
    limit: number,
  ): Promise<TicketEvidenceRecord[]>;
}

export class TicketEvidence {
  constructor(
    private readonly workflow: TicketWorkflow,
    private readonly store: TicketEvidenceStore,
    private readonly journal: TicketJournal,
    private readonly scope: { instance: string; group: number },
    private readonly storage?: { files: TicketEvidenceFiles; secret: string },
  ) {}

  async grant(actor: string, ticket: number, file: Upload) {
    await this.workflow.evidenceAccess(actor, ticket, true);
    const id = randomUUID();
    const expires = Date.now() + 10 * 60_000;
    return {
      upload_id: id,
      grant: this.sign({
        ...this.bound(actor, ticket, id, expires),
        kind: 'upload',
        file: upload.parse(file),
      }),
      expires_at: new Date(expires).toISOString(),
    };
  }
  async write(
    actor: string,
    ticket: number,
    token: string,
    read: () => Promise<Buffer>,
  ) {
    await this.workflow.evidenceAccess(actor, ticket, true);
    const claim = this.claim(token, actor, ticket);
    if (claim.kind !== 'upload') throw new TicketOperationError('INVALID');
    const bytes = await read();
    validateEvidence(bytes, claim.file);
    await this.workflow.evidenceAccess(actor, ticket, true);
    await this.config().files.put(this.key(ticket, claim.id), bytes);
    return { upload_id: claim.id };
  }
  async finalize(
    operation: TicketActorOperation,
    ticket: number,
    token: string,
  ) {
    await this.workflow.evidenceAccess(operation.actor, ticket, true);
    const claim = this.claim(token, operation.actor, ticket, true);
    if (claim.kind !== 'upload') throw new TicketOperationError('INVALID');
    const prepare = async () => {
      const current = await this.workflow.evidenceAccess(
        operation.actor,
        ticket,
        true,
      );
      const bytes = await this.config().files.read(this.key(ticket, claim.id));
      if (!bytes) throw new TicketOperationError('INVALID');
      validateEvidence(bytes, claim.file);
      const sha256 = digest(bytes);
      if (
        await this.store.evidenceByHash(
          this.scope.instance,
          this.scope.group,
          ticket,
          sha256,
        )
      )
        throw new TicketOperationError('CONFLICT');
      const evidence: TicketEvidenceRecord = {
        ...this.scope,
        ticketId: ticket,
        id: claim.id,
        fileName: claim.file.file_name,
        mimeType: claim.file.mime_type,
        fileSize: bytes.length,
        uploadedByUserId: operation.actor,
        createdAt: new Date().toISOString(),
        sha256,
      };
      return {
        ticketId: ticket,
        evidence,
        ...(current
          ? { notification: notificationFor('evidence_added', current) }
          : {}),
        changes: [
          { field: 'evidence_id', after: evidence.id },
          { field: 'mime_type', after: evidence.mimeType },
          { field: 'file_size', after: evidence.fileSize },
        ],
      };
    };
    const result = await this.journal.run(
      {
        ...this.scope,
        actor: operation.actor,
        key: operation.key,
        action: 'evidence_added',
        ticketId: ticket,
        payload: { id: claim.id, file: claim.file },
      },
      async () => {
        const checkpoint = await prepare();
        return () => Promise.resolve(checkpoint);
      },
      prepare,
    );
    if (!result.evidence) throw new TicketOperationError('UNAVAILABLE');
    return result.evidence;
  }
  async list(actor: string, ticket: number, after: string, limit: number) {
    await this.workflow.evidenceAccess(actor, ticket, false);
    const rows = await this.store.listEvidence(
      this.scope.instance,
      this.scope.group,
      ticket,
      after,
      limit + 1,
    );
    return {
      enabled: Boolean(this.storage),
      items: rows.slice(0, limit),
      next: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async access(
    actor: string,
    ticket: number,
    id: string,
    disposition: 'inline' | 'attachment',
  ) {
    const row = await this.record(actor, ticket, id);
    if (disposition === 'inline' && !row.mimeType.startsWith('image/'))
      throw new TicketOperationError('INVALID');
    const expires = Date.now() + 60_000;
    return {
      grant: this.sign({
        ...this.bound(actor, ticket, id, expires),
        kind: 'read',
        disposition,
      }),
      expires_at: new Date(expires).toISOString(),
    };
  }
  async content(actor: string, ticket: number, id: string, token: string) {
    const row = await this.record(actor, ticket, id);
    const claim = this.claim(token, actor, ticket);
    if (claim.kind !== 'read' || claim.id !== id)
      throw new TicketOperationError('DENIED');
    if (claim.disposition === 'inline' && !row.mimeType.startsWith('image/'))
      throw new TicketOperationError('INVALID');
    const bytes = await this.config().files.read(this.key(ticket, id));
    if (!bytes || bytes.length !== row.fileSize || digest(bytes) !== row.sha256)
      throw new TicketOperationError('UNAVAILABLE');
    await this.workflow.evidenceAccess(actor, ticket, false);
    return { row, bytes, disposition: claim.disposition };
  }
  private async record(actor: string, ticket: number, id: string) {
    await this.workflow.evidenceAccess(actor, ticket, false);
    const row = await this.store.evidenceById(
      this.scope.instance,
      this.scope.group,
      ticket,
      id,
    );
    if (!row) throw new TicketOperationError('NOT_FOUND');
    return row;
  }
  private config() {
    if (!this.storage) throw new TicketOperationError('UNAVAILABLE');
    return this.storage;
  }
  private bound(actor: string, ticket: number, id: string, exp: number) {
    return { ...this.scope, ticket, actor, id, exp };
  }
  private key(ticket: number, id: string) {
    return digest(
      JSON.stringify([this.scope.instance, this.scope.group, ticket, id]),
    );
  }
  private sign(claim: Claim) {
    const value = Buffer.from(JSON.stringify(claim)).toString('base64url');
    return (
      value +
      '.' +
      createHmac('sha256', this.config().secret)
        .update(value)
        .digest('base64url')
    );
  }
  private claim(
    token: string,
    actor: string,
    ticket: number,
    finalize = false,
  ): Claim {
    this.config();
    try {
      if (
        token.length > 2048 ||
        !/^[-_A-Za-z0-9]+\.[-_A-Za-z0-9]+$/.test(token)
      )
        throw new Error();
      const [value, tag] = token.split('.');
      const expected = createHmac('sha256', this.config().secret)
        .update(value)
        .digest();
      if (!timingSafeEqual(Buffer.from(tag, 'base64url'), expected))
        throw new Error();
      const claim = claimSchema.parse(
        JSON.parse(Buffer.from(value, 'base64url').toString()),
      );
      if (
        claim.actor !== actor ||
        claim.ticket !== ticket ||
        claim.instance !== this.scope.instance ||
        claim.group !== this.scope.group ||
        claim.exp +
          (finalize && claim.kind === 'upload' ? 24 * 60 * 60_000 : 0) <=
          Date.now()
      )
        throw new Error();
      return claim;
    } catch {
      throw new TicketOperationError('DENIED');
    }
  }
}
function digest(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex');
}
export function validateEvidence(bytes: Buffer, file: Upload) {
  if (bytes.length > evidenceLimit || bytes.length > file.file_size)
    throw new TicketOperationError('TOO_LARGE');
  if (bytes.length !== file.file_size || !detected(bytes, file.mime_type))
    throw new TicketOperationError('INVALID_FILE');
}
function detected(bytes: Buffer, mime: z.infer<typeof evidenceMime>) {
  if (mime === 'image/png')
    return (
      bytes.length >= 45 &&
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      bytes.readUInt32BE(8) === 13 &&
      bytes.toString('ascii', 12, 16) === 'IHDR' &&
      bytes.readUInt32BE(16) > 0 &&
      bytes.readUInt32BE(20) > 0 &&
      bytes.readUInt32BE(16) * bytes.readUInt32BE(20) <= 36_000_000 &&
      bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))
    );
  if (mime === 'image/jpeg') return jpeg(bytes);
  if (mime === 'image/webp') return webp(bytes);
  return (
    /^%PDF-[12]\.\d[\r\n]/.test(bytes.toString('ascii', 0, 16)) &&
    /%%EOF[\r\n\t ]*$/.test(bytes.subarray(-128).toString('ascii'))
  );
}

function boundedDimensions(width: number, height: number) {
  return width > 0 && height > 0 && width * height <= 36_000_000;
}

function jpeg(bytes: Buffer) {
  if (
    bytes.length < 14 ||
    bytes.readUInt16BE(0) !== 0xffd8 ||
    bytes.readUInt16BE(bytes.length - 2) !== 0xffd9
  )
    return false;
  let offset = 2;
  let dimensions = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (offset + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length >= bytes.length) return false;
    if (marker === 0xda) return dimensions;
    if (
      [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf,
      ].includes(marker)
    ) {
      if (
        length < 8 ||
        !boundedDimensions(
          bytes.readUInt16BE(offset + 5),
          bytes.readUInt16BE(offset + 3),
        )
      )
        return false;
      dimensions = true;
    }
    offset += length;
  }
  return false;
}
function webp(bytes: Buffer) {
  if (
    bytes.length < 30 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP' ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  )
    return false;
  const kind = bytes.toString('ascii', 12, 16);
  const chunkSize = bytes.readUInt32LE(16);
  if (20 + chunkSize > bytes.length) return false;
  if (kind === 'VP8X')
    return (
      chunkSize === 10 &&
      boundedDimensions(
        1 + bytes.readUIntLE(24, 3),
        1 + bytes.readUIntLE(27, 3),
      )
    );
  if (kind === 'VP8L') {
    if (chunkSize < 5 || bytes[20] !== 0x2f) return false;
    const dimensions = bytes.readUInt32LE(21);
    return boundedDimensions(
      1 + (dimensions & 0x3fff),
      1 + ((dimensions >>> 14) & 0x3fff),
    );
  }
  return (
    kind === 'VP8 ' &&
    chunkSize >= 10 &&
    bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex')) &&
    boundedDimensions(
      bytes.readUInt16LE(26) & 0x3fff,
      bytes.readUInt16LE(28) & 0x3fff,
    )
  );
}
