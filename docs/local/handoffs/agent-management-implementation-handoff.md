# Agent Management Implementation Handoff

**Checkpoint:** 2026-11-01
**Scope:** Agent enrollment increments I1–I5 in Core Backend
**Status:** Enrollment lifecycle implemented; Agent operational APIs remain future work.

## What is implemented

- **I1 — Bootstrap token issuance:** Admins with `agent:manage` can issue a
  Node-bound, single-use token. Node eligibility comes through the Asset &
  Topology public contract. Tokens expire after 10 minutes; only hashes are
  stored, reissue invalidates the previous unused token, and expiry is checked
  explicitly as well as cleaned up by a MongoDB TTL index.
- **I2 — Enrollment:** The Agent submits the bootstrap token, stable installation
  ID, attempt ID, Agent version, environment, and optional metadata. Core
  atomically consumes the token and persists the installation, active binding,
  credential metadata, attempt, and business fact in a MongoDB transaction. The
  response is `201 Created`; credentials are opaque and stored hash-only.
- **I3 — Recovery:** Matching retries use a deterministic request fingerprint
  and a 24-hour AES-256-GCM encrypted result escrow. A valid recovery returns
  `200 OK`. Expired or revoked recovery returns `410`; recovery data is never
  allowed to restore a revoked credential.
- **I4 — Authentication and revocation:** The opt-in
  `@AgentAuthenticated()` guard validates an opaque bearer credential against
  active credential, binding, and installation records and sets a trusted Agent
  principal. Admin revocation runs transactionally, invalidates credentials,
  appends a secret-free audit fact once, and returns `204` for first and
  repeated requests. Re-enrollment can reuse an installation ID while keeping
  historical bindings.
- **I5 — Integration readiness:** The current contract and Agent handoff are
  published in the shared docs repository. The Control Plane URL in enrollment
  output is configuration only; it does not indicate a working Control Plane.

## Current HTTP API

| Method and route | Caller | Behavior |
| --- | --- | --- |
| `POST /api/v1/nodes/{nodeId}/agent-bootstrap-tokens` | Human IAM, `agent:manage` | `201`; returns a bootstrap token once with `Cache-Control: no-store`. |
| `POST /api/v1/agent-enrollments` | Public route; bootstrap token in the request | `201` for new enrollment; `200` for matching recovery. |
| `POST /api/v1/agent-bindings/{bindingId}/revoke` | Human IAM, `agent:manage` | `204` for first or repeated revocation. |

The Agent authentication guard is implemented, but no production route currently
uses it. Bootstrap tokens are enrollment-only. Agent credentials do not
authorize Human/Admin APIs and are not OTLP Gateway credentials.

## Code structure and boundaries

The module is organized under
[`src/modules/agent-management/`](../../../src/modules/agent-management/):

- `application/` contains use cases and public persistence/eligibility ports.
- `infrastructure/mongodb/` implements persistence and MongoDB migrations;
  `infrastructure/security/` implements recovery encryption.
- `presentation/` contains HTTP controllers, the Agent guard, and principal
  decorator.
- `agent-management.module.ts` composes the adapters and Asset & Topology public
  query contract.

There is currently **no `domain/` directory or separate domain model** in this
module. Business decisions are represented in application use cases and
application port errors; framework and database details remain in
infrastructure/presentation. The earlier proposed `domain/` tree was a logical
option, not an implemented structure.

## Persistence and configuration

Agent Management uses the existing MongoDB Unit of Work, migration registry, and
Outbox writer. Index migrations cover bootstrap-token uniqueness/TTL, active
binding uniqueness by Node and installation, stable installation identity,
credential lookup, enrollment-attempt identity, and credential lookup by
binding/status. MongoDB transactions require a replica set.

Required configuration:

- `AGENT_CONTROL_PLANE_BASE_URL`: HTTPS URL returned as a future-service
  pointer; no Control Plane endpoints are implemented.
- `AGENT_ENROLLMENT_RECOVERY_KEY`: base64-encoded 32-byte AES-256 key shared by
  Core instances and kept stable until the 24-hour recovery window expires.

## Not implemented

No Agent Control Plane APIs, heartbeat, telemetry ingestion, configuration
synchronization, Collector activation, uninstall reporting, credential renewal,
or credential rotation are included. Agent operational readiness therefore
depends on later work beyond enrollment.

## Verification and references

The source includes application, persistence/index migration, HTTP, recovery,
authentication, revocation, and concurrency tests under each module's
`__tests__/` folders. MongoDB transaction/index integration requires the
repository's replica-set test setup. The latest logging change passed focused
tests, ESLint, Prettier, TypeScript build checking, and Nest build; the
enrollment HTTP test could not bind its local test port in the restricted
execution environment (`EACCES`).

For the Agent-facing endpoint inventory, payload examples, retry lifecycle,
errors, and integration checklist, see
[`docs/shared/integration/telemetry-agent-core-enrollment.md`](../../shared/integration/telemetry-agent-core-enrollment.md).
The local design source is
[`flow-02-agent-enrollment-server-design.md`](../business/flow-02-agent-enrollment-server-design.md),
and the published Core OpenAPI source is
[`api/v1/agent-enrollment.yaml`](../../../api/v1/agent-enrollment.yaml).
