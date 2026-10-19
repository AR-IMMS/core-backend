import { DomainError } from '../shared/domain-error';
import type { DataCenterId } from './data-center';

/** Canonical identity for a Site in Asset & Topology. */
export type SiteId = string & { readonly __assetTopologyId: 'SiteId' };

/** Values required to register a Site under the seeded Data Center. */
export interface CreateSiteProps {
  readonly id: SiteId;
  readonly name: string;
  readonly dataCenterId: DataCenterId;
}

/** A managed location directly beneath a Data Center. */
export class Site {
  private constructor(
    public readonly id: SiteId,
    public readonly name: string,
    public readonly dataCenterId: DataCenterId,
  ) {}

  /** Creates a Site with a required stable ID, name, and Data Center reference. */
  static create(props: CreateSiteProps): Site {
    const id = props.id.trim();
    const name = props.name.trim();
    const dataCenterId = props.dataCenterId.trim();
    if (!id) throw new DomainError('SITE_ID_REQUIRED', 'Site ID is required');
    if (!name)
      throw new DomainError('SITE_NAME_REQUIRED', 'Site name is required');
    if (!dataCenterId)
      throw new DomainError(
        'SITE_DATA_CENTER_REQUIRED',
        'Site Data Center is required',
      );

    return new Site(id as SiteId, name, dataCenterId as DataCenterId);
  }

  /** Returns an updated Site while retaining its identity and parent reference. */
  rename(name: string): Site {
    const normalized = name.trim();
    if (!normalized)
      throw new DomainError('SITE_NAME_REQUIRED', 'Site name is required');

    return new Site(this.id, normalized, this.dataCenterId);
  }
}
