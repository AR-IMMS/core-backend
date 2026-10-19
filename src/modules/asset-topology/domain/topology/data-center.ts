/** Canonical identity for a Data Center in Asset & Topology. */
export type DataCenterId = string & {
  readonly __assetTopologyId: 'DataCenterId';
};

/** Stable identity provisioned for the default Flow 1 Data Center. */
export const DEFAULT_DATA_CENTER_ID = 'dc-default' as DataCenterId;

/** Read-only Data Center reference returned to Flow 1 consumers. */
export interface DataCenterReference {
  readonly id: DataCenterId;
  readonly name: string;
}
