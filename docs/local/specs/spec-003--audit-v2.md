# SPEC-003 — Audit Fact v2 for Permission Set Changes

**Status:** Proposed  
**Date:** 2026-10-14  
**Scope:** Internal `audit.fact` contract and Audit persistence/read compatibility.

## 1. Purpose

Allow IAM to record replacement of a user’s additional permission set in one Audit fact while preserving the original value types and compatibility with existing v1 facts.

## 2. Requirements

1. **Keep v1 unchanged.** The `audit.fact` v1 contract and parser remain immutable. The Audit consumer must support both v1 and v2. A v1 payload must never be reinterpreted using v2 rules.

2. **Supported values in v2.** Each field may appear only once in `changes`. `before` and `after` may be a scalar supported by v1 or a flat array of strings. Reject objects, nested arrays, and other value types. Preserve the original value type through persistence and API responses.

3. **Permission set changes.** Reserve `additional_permissions` for permission set changes. Each present value must be an array of valid permission codes without duplicates. A replacement must be represented by one fact containing the complete previous and next sets. Either side may be omitted to represent creation or removal of the entire field; if both sides are present, both must be arrays.

4. **Permission validation.** IAM owns the authoritative permission catalog. Audit must validate codes through a narrow public contract and must not depend on IAM internals or maintain a duplicate catalog.

5. **Size limits.** Each permission array may contain at most 64 entries. The serialized payload may not exceed 16 KiB (16,384 UTF-8 bytes). Enforce the payload limit before deep traversal or persistence.

6. **Sensitive data.** Retain the existing sensitive-field denylist. V2 must reject passwords, tokens, credential hashes, secrets, and complete user or resource snapshots.

7. **Persistence and reads.** Store `event_version` with each Audit record. Keep `appendIfAbsent(event_id)` as the idempotency boundary. The read API must return the original event version and value types. Existing v1 records retain their current interpretation and shape.

8. **OpenAPI.** Update `AuditChange` to describe scalar values and string arrays. Document that arrays are supported by event v2 and that permission arrays are validated against the IAM catalog. The API must not coerce arrays to strings. The event version change does not alter the public REST path.

## 3. Acceptance Criteria

- The consumer routes and validates v1 and v2 separately.
- V2 permission arrays are validated against the catalog and the entry-count limit; duplicate entries are rejected.
- The parser rejects duplicate fields, unsupported value types, nested arrays, and payloads over the size limit.
- Audit records preserve `event_version` and are idempotent by `event_id`.
- The API preserves scalar and array values, and existing v1 records remain readable.
- Tests cover v1 compatibility, invalid values, unknown permission codes, duplicates, size limits, and duplicate event delivery.

## 4. References

- `docs/local/adr/adr-001--platform-event-bus-for-core-modular-monolith.md`
- `docs/local/specs/spec-001--platform-events.md` §6.4
- `docs/local/specs/spec-002--epic-iam-module.md` §12
- `api/v1/audit.yaml`
