# ADR-002: Audit Fact v2 for Permission Set Changes

- **Status:** Proposed
- **Date:** 2026-10-14
- **Scope:** Internal `audit.fact` contract and Audit persistence/read compatibility

## Context

The current shared `audit.fact` v1 payload permits only scalar `before` and
`after` values. IAM replaces a user's additional permission set as one business
operation, but representing the full change as one fact is not possible without
losing structure or splitting one state transition across several facts. The
IAM epic explicitly leaves this as a contract review gate.

Audit facts are delivered at least once through the transactional Outbox. Audit
validates payloads before append-only persistence and deduplicates by
`event_id`. The event registry routes by exact `(event_type, event_version)`,
so v2 can be introduced while retaining the existing v1 consumer path.

## Decision

1. Keep `audit.fact` version 1 immutable for old Outbox entries and stored
   records. Add a separate v2 contract/parser and accept both versions in the
   Audit consumer. Do not silently reinterpret v1 payloads as v2.
2. In v2, each change field remains unique within a fact. A `before` or `after`
   value may be a v1 scalar or a flat array of strings. Reject nested arrays,
   objects, and all other value types. Preserve arrays as arrays through
   persistence and API serialization.
3. Reserve the `additional_permissions` change field for permission-set
   changes. Its present values are arrays of permission codes; each code must
   belong to the authoritative fixed IAM permission catalog and each array
   must contain unique entries. An absent side represents creation/removal of
   the whole field; when both sides are present, both must be arrays. Producers
   emit one v2 fact for one permission-set replacement, with the complete
   previous and next sets, rather than one fact per code.
4. Keep catalog ownership in IAM. Audit validates permission codes through a
   narrow public catalog-validation contract supplied at application
   composition; it must not import IAM domain internals or maintain a second
   copy of the catalog. The v2 parser accepts the catalog validator as an
   explicit dependency so its validation remains deterministic and testable.
5. Set a maximum of 64 entries per permission array and a maximum serialized
   payload size of 16 KiB (16,384 UTF-8 bytes). Enforce the payload limit before
   expensive traversal and persistence. These limits leave room above the
   current fixed catalog while bounding event and record size; revise them only
   through a contract decision.
6. Keep the existing sensitive-field-name denylist and extend it, where
   needed, to reject password, token, credential hash, secrets, and complete
   user/resource snapshots. V2 does not permit arbitrary object payloads or
   full snapshots.
7. Store the originating `event_version` with the Audit record. Keep
   `appendIfAbsent(event_id)` as the idempotency boundary. The read API exposes
   the matching version and the original scalar/array value types; v1 records
   retain their existing interpretation and shape.
8. Update the OpenAPI `AuditChange` schema to represent scalar values and
   string arrays, with a description that arrays are supported by v2 and
   permission arrays are catalog-validated. The API must not coerce arrays to
   strings. This internal event version does not change the public REST path.

## Alternatives considered

### Emit one fact for each changed permission

Rejected because one set replacement would become several audit records,
making the atomic before/after state difficult to reconstruct and potentially
misrepresenting the single business operation.

### Encode arrays as delimited or JSON strings

Rejected because it loses type information and forces consumers to parse an
opaque scalar.

### Broaden v1 in place

Rejected because old consumers and stored records rely on v1's scalar-only
contract. A new event version makes the compatibility boundary explicit.

### Let Audit own a duplicate permission catalog

Rejected because it would drift from IAM's authoritative catalog and create a
cross-module consistency risk.

## Consequences

- Producers changing additional permissions must publish v2 facts and include
  the full prior and resulting permission-code sets.
- Audit consumers must support v1 and v2 concurrently and persist the actual
  event version.
- Consumer registration must subscribe to both exact versions; v1 fixtures and
  persisted records remain readable.
- The API schema and serializers must preserve JSON arrays without string
  conversion.
- The Audit/IAM public catalog-validation contract and its composition wiring
  must be implemented before v2 permission facts can be accepted.
- Parser tests must cover malformed arrays, unknown permission codes,
  duplicates, duplicate fields, nested values, payload limits, v1 compatibility,
  and event-id idempotency.

## Implementation notes

- Keep v1 source and behavior intact; introduce `audit-fact.v2.ts` rather than
  widening the v1 parser's types.
- Dispatch validation by `event_version` in the Audit consumer and persist the
  validated payload without normalizing arrays.
- The API must model the value union without implying that v1 records can
  contain arrays.
- Update the IAM epic's audit integration section when v2 is accepted and
  implemented, including the producer's one-fact permission-set example.

## References

- `docs/local/adr/adr-001--platform-event-bus-for-core-modular-monolith.md`
- `docs/local/specs/spec-001--platform-events.md`, section 6.4
- `docs/local/specs/spec-002--epic-iam-module.md`, section 12
- `api/v1/audit.yaml`
