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
/**
 * Brands a positive integer as a Business Fact contract version.
 * @param version Positive safe integer version.
 * @returns Branded version retaining its literal numeric type.
 * @example `const version = businessFactVersion(1)`
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
  /** Request correlation identifier when available. */
  readonly request_id?: string;
  /** Distributed trace identifier when available. */
  readonly trace_id?: string;
}

/** Identifies the resource changed by the producer. */
export interface BusinessFactResource {
  /** Stable resource category used for ordering. */
  readonly type: string;
  /** Stable resource identifier. */
  readonly id: string;
  /** Strictly increasing sequence for facts concerning this resource. */
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
  /** Globally unique identifier for this fact. */
  readonly event_id: string;
  /** Stable producer-owned event contract name. */
  readonly event_type: TEventType;
  /** Positive event contract version. */
  readonly event_version: TVersion;
  /** Stable identifier of the producing module. */
  readonly producer: string;
  /** ISO 8601 timestamp in UTC. */
  readonly occurred_at: string;
  /** Resource ordering and identity data. */
  readonly resource: BusinessFactResource;
  /** Producer-owned, explicitly versioned public payload. */
  readonly payload: TPayload;
  /** Optional request and trace correlation metadata. */
  readonly context: BusinessFactContext;
}
