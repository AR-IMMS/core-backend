import { TicketReadError } from '../application/ticket-read.port';
import {
  parseZammadReadConfig,
  type ZammadReadConfig,
} from './zammad-read.config';
/** Internal fixed-resource GET transport. Never expose resource selection to clients. */
export class ZammadReadClient {
  readonly #config: ZammadReadConfig;
  constructor(config: ZammadReadConfig) {
    this.#config = parseZammadReadConfig(config);
  }
  async get(
    resource: `tickets/${number}` | `users/${number}` | 'users/me',
  ): Promise<unknown> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.#config.timeoutMs);
    try {
      const response = await fetch(
        `${this.#config.baseUrl}/api/v1/${resource}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Token token=${this.#config.apiToken}`,
            Accept: 'application/json',
          },
          redirect: 'manual',
          signal: abort.signal,
        },
      );

      if (response.status !== 200) {
        // Discard even error bodies: they may echo credentials or Ticket data.
        await response.body?.cancel();
        if (response.status === 404) return null;
        if (response.status === 401 || response.status === 403) {
          throw new TicketReadError('UPSTREAM_ACCESS_DENIED');
        }
        if (response.status >= 500 || response.status === 429) {
          throw new TicketReadError('UPSTREAM_UNAVAILABLE');
        }
        throw new TicketReadError('UNEXPECTED_UPSTREAM_STATUS');
      }

      const mediaType = response.headers
        .get('content-type')
        ?.split(';')[0]
        .trim()
        .toLowerCase();
      if (mediaType !== 'application/json') {
        await response.body?.cancel();
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      }
      const text = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      }
      if (body === null) throw new TicketReadError('INVALID_UPSTREAM_RESPONSE');
      return body;
    } catch (error: unknown) {
      if (abort.signal.aborted) throw new TicketReadError('UPSTREAM_TIMEOUT');
      if (error instanceof TicketReadError) throw error;
      throw new TicketReadError('UPSTREAM_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
}
