/**
 * Identifies a producer-owned Business Fact contract version.
 */
declare const businessFactVersionBrand: unique symbol;

export type BusinessFactVersion<TVersion extends number = number> = TVersion & {
  readonly [businessFactVersionBrand]: true;
};

/**
 * Creates a version value for a producer-owned Business Fact contract.
 */
export function businessFactVersion<const TVersion extends number>(
  version: TVersion,
): BusinessFactVersion<TVersion> {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError(
      'Business Fact versions must be positive safe integers',
    );
  }

  return version as BusinessFactVersion<TVersion>;
}

/** Permitted correlation metadata shared with Business Fact consumers. */
export interface BusinessFactContext {
  readonly request_id?: string;
  readonly trace_id?: string;
}

/** Identifies the resource changed by the producer. */
export interface BusinessFactResource {
  readonly type: string;
  readonly id: string;
  readonly sequence: number;
}

/**
 * Stable, versioned fact contract shared across Core module boundaries.
 * Producer payload types belong to producer modules and must not contain
 * aggregate instances, persistence documents, secrets, or unrestricted snapshots.
 */
export interface BusinessFactEnvelope<
  TPayload = unknown,
  TEventType extends string = string,
  TVersion extends BusinessFactVersion = BusinessFactVersion,
> {
  readonly event_id: string;
  readonly event_type: TEventType;
  readonly event_version: TVersion;
  readonly producer: string;
  /** ISO 8601 timestamp in UTC. */
  readonly occurred_at: string;
  readonly resource: BusinessFactResource;
  readonly payload: TPayload;
  readonly context: BusinessFactContext;
}
