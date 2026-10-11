# Ticket draft: Platform Events

**Source:**

- `docs/specs/spec-001--platform-events.md`;
- `docs/adr/adr-001--platform-event-bus-for-core-modular-monolith.md`; user-provided six-task breakdown

**Review status:** approved
**Target:** [AR-IMMS Dashboard](https://github.com/orgs/AR-IMMS/projects/2) (`AR-IMMS/core-backend`)

## 1. Event Contracts & Unit of Work

**Ticket ID:** `PE-001`
**Labels:** `type:feature`, `scope:backend`
**Published:** [#2](https://github.com/AR-IMMS/core-backend/issues/2)

**What to build:** Establish the application-facing contracts that let producer modules create versioned Business Facts and atomically enlist them with their business writes, without exposing producer domain models or MongoDB session types to Platform Events consumers.

**Acceptance criteria**

- [x] A typed Business Fact envelope captures a unique event ID, stable namespaced event type, positive contract version, producer, UTC occurrence time, resource type/ID/monotonic sequence, typed payload, and permitted request/trace context.
- [x] Producer-owned fact payloads remain versioned under their producer contract boundary; compatible evolution keeps the event type stable, breaking changes use a new version, and consumers declare supported event types and versions explicitly.
- [x] The envelope and port contracts do not expose producer aggregates, database documents, MongoDB sessions, secrets, or unrestricted resource snapshots; platform exports only intended contracts and tokens.
- [x] Application-facing ports cover appending facts through an opaque transaction context, delivering/claiming eligible consumer work, handling a typed fact by a registered consumer, and running a bounded Unit of Work operation.
- [x] The Unit of Work contract passes an opaque context explicitly to participating repository and Outbox operations; it does not wrap asynchronous consumer handling or require a cross-service transaction.
- [x] Contract-level unit tests or compile-time examples demonstrate valid versioned facts and port usage without `any`; no adapter or empty placeholder files are required solely to match the proposed tree.

**Blocked by:** None

## 2. MongoDB Outbox

**Ticket ID:** `PE-002`
**Labels:** `type:feature`, `scope:backend`
**Published:** [#3](https://github.com/AR-IMMS/core-backend/issues/3)

**What to build:** Persist producer Business Facts as delivery records using the existing MongoDB connection, with an infrastructure-owned schema and operations that can participate in the producer's Unit of Work transaction.

**Acceptance criteria**

- [x] An Outbox append operation accepts the Business Fact and opaque Unit of Work context and uses the same MongoDB session as enlisted producer writes; it does not create a separate transaction.
- [x] The persisted record contains the serialized envelope and per-consumer delivery metadata, including state, attempts, next eligible retry time, timestamps, and claim/lease data if required by the chosen claim strategy.
- [x] New facts are not eligible for delivery before their transaction commits; transaction abort or commit failure leaves no deliverable Outbox record.
- [x] Delivery state is isolated by `(event_id, consumer_id)` so one consumer's status cannot overwrite another's; the Outbox remains a delivery buffer and is not exposed as an Audit query store.
- [x] Storage operations support selecting eligible pending/retryable work and recording claim, success, and retryable failure while preserving the adapter's ordering eligibility rules.
- [x] MongoDB schemas, models, and session details remain inside infrastructure; the existing `DatabaseModule` continues to own connection configuration.
- [x] Focused adapter tests verify persistence and independent per-consumer state; transaction semantics are reserved for the replica-set test environment.

**Blocked by:** Ticket 1

## 3. Event Relay

**Ticket ID:** `PE-003`
**Labels:** `type:feature`, `scope:backend`
**Published:** [#4](https://github.com/AR-IMMS/core-backend/issues/4)

**What to build:** Deliver committed Outbox facts through an in-process adapter with at-least-once semantics, tracking retries independently per consumer while preserving sequence order for each resource.

**Acceptance criteria**

- [x] The relay asks the Outbox delivery port for eligible committed work, resolves a consumer through the dispatch contract, awaits its completion, and records completion only after successful handling.
- [x] A handler failure remains incomplete, increments/records attempt state, and becomes eligible for retry according to a documented implementation retry policy; the relay safely tolerates a handler completing before acknowledgement persistence fails.
- [x] A failed delivery for one consumer does not block a different consumer's independent progress for the same fact, and a completed consumer is not redelivered when another consumer retries.
- [x] For each `(resource.type, resource.id, consumer_id)`, sequence `N+1` is ineligible while `N` is pending, claimed, or failed; completion of `N` makes the next sequence eligible.
- [x] Different resources progress independently, and no global order or exactly-once guarantee is claimed.
- [x] The relay does not delete a fact after one consumer succeeds; retention/dead-letter behavior and manual replay remain out of scope.
- [x] Unit tests assert observable acknowledgement, retry, per-consumer progress, same-resource ordering, and independent-resource progress rather than private helper call sequences.

**Blocked by:** Ticket 2

## 4. Consumer Registry & Audit

**Ticket ID:** `PE-004`
**Labels:** `type:feature`, `scope:backend`
**Published:** [#5](https://github.com/AR-IMMS/core-backend/issues/5)

**What to build:** Register consumers explicitly at module composition time and add the initial Audit consumer for one shared, versioned, business-neutral Audit Fact contract, with append-only persistence and idempotent handling.

**Implementation note:** Audit consumes the shared `audit.fact` v1 contract. Producers emit it with actor, action, resource, context, and their explicit scalar change allowlist. Audit does not map producer-specific Business Facts; no business event types are auto-registered.

**Acceptance criteria**

- [x] The registry maps explicitly supported event type/version pairs to one or more consumers with stable consumer IDs; it does not use broad wildcard subscriptions or arbitrary runtime reflection.
- [x] Dispatch invokes only matching consumers, awaits durable consumer completion before reporting success, and leaves unsupported facts or consumer failures unacknowledged according to the delivery contract.
- [x] Audit implements the consumer contract in its own module boundary and accepts only the shared versioned Audit Fact contract; it does not import or map producer-specific schemas.
- [x] Audit records are append-only and include actor, action, resource, occurrence time, and permitted context; changes contain only producer-allowlisted scalar before/after values, with no unrestricted snapshots or secrets.
- [x] Audit effect and its `event_id` deduplication record are atomic; a successfully processed duplicate returns success without creating a second effect, while duplicate-in-progress handling cannot produce a second durable record.
- [x] Audit has no client-facing write endpoint for arbitrary facts; query APIs, authorization, and tenant scoping are outside this ticket unless already part of a separately accepted Audit scope.
- [x] Tests verify routing by event type/version, exclusion of unrelated business events, multiple consumers, Audit Fact validation and change allowlists, and duplicate idempotency.

**Blocked by:** Ticket 1 and Ticket 3

## 5. NestJS Wiring & Mongo Replica Set

**Ticket ID:** `PE-005`
**Labels:** `type:infra`, `scope:backend`
**Published:** [#6](https://github.com/AR-IMMS/core-backend/issues/6)

**What to build:** Compose Platform Events and the initial Audit consumer through NestJS module boundaries, and provide a repeatable local/CI MongoDB replica-set setup for transaction-backed verification.

**Implementation note:** `PlatformEventsModule.register` explicitly receives the Audit consumer module/token, binds event ports to the shared Mongo connection adapters and in-process registry/relay, and exports the intended application tokens. Compose starts MongoDB as replica set `rs0`; the e2e setup requires `MONGODB_TEST_URI` with an isolated `_test` database.

**Acceptance criteria**

- [x] `PlatformEventsModule` binds the transport-neutral ports to the in-process dispatch/relay and MongoDB Outbox/Unit of Work adapters; it reuses the existing database connection.
- [x] Producer-facing application modules can import the intended event capability, and Audit registers its consumer explicitly through module composition; the root module composes the capability without coupling HTTP internals to event dispatch.
- [x] The platform public barrel exports only intended shared contracts/tokens and does not export Mongoose models or adapter internals.
- [x] Docker Compose provides a MongoDB replica-set service suitable for transactions, with an initialization/health-readiness path that confirms the replica set is ready before tests run.
- [x] Test configuration reads `MONGODB_TEST_URI`, uses a database name isolated from development/production data, and documents or automates startup and cleanup without requiring an external broker or new test package.
- [x] Nest and Mongoose test/application contexts close cleanly; the existing database module remains the owner of connection configuration.
- [x] Setup documentation states the local commands and required test URI, and does not imply that a standalone MongoDB server supports transaction tests.

**Blocked by:** Ticket 2 and Ticket 4

## 6. Integration & E2E Tests

**Ticket ID:** `PE-006`
**Labels:** `type:test`, `scope:backend`
**Published:** [#7](https://github.com/AR-IMMS/core-backend/issues/7)

**What to build:** Verify the event capability at its application boundaries, including durable MongoDB behavior and atomic producer transactions on the Compose replica set.

**Implementation note:** The replica-set integration scenarios run in a standalone Node child process launched by Jest. Jest's VM caused the MongoDB driver to produce an empty handshake metadata document; standalone Node produces the required metadata and connects normally. The Outbox entry schema disables Mongoose minimization so valid empty fact context objects survive persistence.

**Acceptance criteria**

- [x] Unit coverage verifies registry routing by type/version, relay success/failure acknowledgement and retry, and per-resource ordering with independent resources.
- [x] Mongo Outbox integration coverage verifies fact persistence and separate delivery progress for multiple consumers.
- [x] In-process bus, registry, relay, and representative consumer integration coverage verifies successful delivery and retry after a consumer failure.
- [x] A critical test runs a producer write through the real Mongo Unit of Work and Outbox adapter: commit leaves both business state and fact; relay delivers the fact to a registered consumer.
- [x] The critical test forces a producer failure before commit and proves neither the business write nor the Outbox fact remains; it also verifies sequence-ordered delivery for multiple facts on one resource.
- [x] Consumer tests prove a duplicate successful `event_id` does not repeat the durable effect, and delivery tests prove one consumer's success does not suppress another consumer's progress.
- [x] Integration/transaction tests use the documented `MONGODB_TEST_URI` against the Compose replica set, isolate and clean their test database, and close Nest/Mongoose resources.
- [x] Tests assert committed state, delivery state, ordering, and consumer effects; no test substitutes mocked transaction semantics for the critical MongoDB transaction proof.
- [x] No public event-ingress E2E endpoint is added: the spec prohibits client publication of internal facts. If an existing application E2E harness exercises module composition, it may cover the internal path without introducing such an endpoint.
- [x] Final integration verification ran focused tests, the platform test set, lint, typecheck, and build; Mongo service-backed verification passed. Repository-wide lint/typecheck/build report existing errors outside the changed event/test paths.

**Blocked by:** Tickets 1–5
