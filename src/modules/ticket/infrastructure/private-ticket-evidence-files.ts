import { link, readFile, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TicketOperationError } from '../application/ticket-journal';
import type { TicketEvidenceFiles } from '../application/ticket-evidence';

function errno(error: unknown, code: string) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code,
  );
}
export class PrivateTicketEvidenceFiles implements TicketEvidenceFiles {
  constructor(private readonly root: string) {
    if (!isAbsolute(root))
      throw new Error(
        'Ticket Evidence storage requires an absolute private directory',
      );
  }
  private path(key: string) {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new TicketOperationError('INVALID');
    return join(this.root, key);
  }
  async read(key: string) {
    try {
      return await readFile(this.path(key));
    } catch (error) {
      if (errno(error, 'ENOENT')) return null;
      throw new TicketOperationError('UNAVAILABLE');
    }
  }
  async put(key: string, bytes: Buffer) {
    const final = this.path(key);
    const staging = join(this.root, '.upload-' + randomUUID());
    try {
      await writeFile(staging, bytes, { flag: 'wx', mode: 0o600, flush: true });
      try {
        await link(staging, final);
      } catch (error) {
        if (!errno(error, 'EEXIST')) throw error;
        if (!(await this.read(key))?.equals(bytes))
          throw new TicketOperationError('CONFLICT');
      }
    } catch (error) {
      if (error instanceof TicketOperationError) throw error;
      throw new TicketOperationError('UNAVAILABLE');
    } finally {
      await unlink(staging).catch(() => {});
    }
  }
}
