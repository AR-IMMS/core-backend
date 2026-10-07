# Platform Events Specification

**Status:** Accepted design baseline

**Applies to:** Core Backend modular monolith

**Related ADR:** [ADR-001](../adr/adr-001--platform-event-bus-for-core-modular-monolith.md)

## 1. Purpose and scope

This document specifies the internal Platform Event Bus for Core.
It defines ownership, contracts, persistence boundaries, delivery, and tests.
The target runtime is a NestJS modular monolith.
The first consumer is the Audit module.
The current transport is in-process.
The current durable Outbox adapter is MongoDB-backed.
The design preserves boundaries useful for a later service split.
This specification does not introduce a broker or deployment topology.
It does not define a public event-ingestion API.
It does not define event sourcing or a general replay platform.
It does not define retention, archival, or dead-letter operations.

## 2. Design principles

Modules own their domain concepts and persistence models.
Cross-module communication uses explicit Business Fact contracts.
Domain Events and Business Facts have distinct purposes.
Application code depends on ports rather than database or transport SDKs.
Infrastructure adapters implement those ports.
Business state and its Outbox fact commit atomically.
Delivery is at least once; consumers provide idempotent effects.
Order is guaranteed per resource, not globally.
Tests validate behavior across boundaries, not every helper function.
Implementation and test code must not use unsafe `any`.
Code comments and documentation use English.

## 3. Event terminology

### 3.1 Domain Event

A Domain Event describes something that happened inside one module.
It is owned by that module's domain layer.
It may use module-specific types and terminology.
It is not published directly to other modules.
It is not a transport or persistence contract.

### 3.2 Business Fact

A Business Fact is a stable, versioned statement for other modules.
It is created by translating relevant Domain Events.
It is owned and versioned by the producing module.
It contains only data required by intended consumers.
It must not expose a producer aggregate or database document.
The initial consumer is Audit.

### 3.3 Outbox entry

An Outbox entry is a durable delivery record for a Business Fact.
It is written in the same transaction as the business state change.
It includes delivery metadata needed by the relay and consumers.
It is a delivery mechanism, not a queryable event history.
Audit records are the durable source for Audit queries.

## 4. Ownership and module boundaries

### 4.1 Platform Events owns

- The Business Fact envelope shared by platform adapters.
- Transport-neutral consumer and delivery ports.
- Consumer registration and dispatch coordination.
- Outbox delivery orchestration and retry state transitions.
- The in-process event bus implementation.
- The MongoDB Outbox schema and adapter.
- The Platform Events Nest module and dependency wiring.
- The Unit of Work abstraction required by transactional producers.

### 4.2 Producer module owns

- Its Domain Events and aggregate behavior.
- Its versioned Business Fact schemas and payload meaning.
- Translation from Domain Events to Business Facts.
- The application use case coordinating the Unit of Work.
- Repository operations that persist producer business state.

### 4.3 Audit module owns

- Audit-specific event handling and mapping to Audit records.
- The Audit record model, persistence, and query behavior.
- Audit field allowlists and before/after change rules.
- Audit idempotency behavior for repeated Business Facts.
- Public Audit query endpoints and their authorization policy.

### 4.4 Dependency direction

- Producer application code may depend on Platform Events ports.
- Platform Events must not import producer domain entities.
- The platform registry receives consumers through module wiring.
- The Audit infrastructure adapter implements the consumer contract.
- A consumer uses producer facts through their versioned contract type.
- No module reads another module's repository directly.
- No controller publishes an internal Business Fact from user input.

## 5. Proposed source structure

```text
src/
├── platform/events/
│   ├── domain/
│   │   └── business-fact-envelope.ts
│   ├── application/
│   │   ├── ports/
│   │   │   ├── outbox-writer.port.ts
│   │   │   ├── outbox-delivery.port.ts
│   │   │   ├── event-consumer.port.ts
│   │   │   └── unit-of-work.port.ts
│   │   ├── event-consumer.registry.ts
│   │   └── outbox-relay.service.ts
│   ├── infrastructure/
│   │   ├── in-process/
│   │   │   └── in-process-event-bus.ts
│   │   └── mongodb/
│   │       ├── outbox.schema.ts
│   │       ├── mongo-outbox.store.ts
│   │       └── mongo-unit-of-work.ts
│   ├── events.module.ts
│   └── index.ts
└── modules/
    ├── <producer>/
    │   ├── domain/events/
    │   ├── contracts/events/v1/
    │   └── application/events/
    └── audit/
        └── infrastructure/events/
```

The tree defines boundaries; it does not require adding empty files.
Names may follow repository conventions while preserving ownership.
Only the MongoDB adapter is implemented for the current persistence setup.
A future adapter must implement the same application-facing ports.
The platform barrel exports intended shared contracts and tokens only.
Mongoose models and adapter-specific details stay inside infrastructure.

## 6. Business Fact envelope

### 6.1 Required fields

- `event_id` uniquely identifies one fact across retries.
- `event_type` is a stable namespaced fact name owned by the producer.
- `event_version` identifies the contract version.
- `producer` identifies the owning module.
- `occurred_at` is the time the fact occurred, in UTC.
- `resource.type` identifies the affected resource kind.
- `resource.id` identifies the affected resource.
- `resource.sequence` orders facts for that resource.
- `payload` contains versioned producer-owned fact data.
- `context` carries permitted correlation metadata.

### 6.2 Illustrative shape

```ts
interface BusinessFactEnvelope<TPayload> {
  event_id: string;
  event_type: string;
  event_version: number;
  producer: string;
  occurred_at: string;
  resource: {
    type: string;
    id: string;
    sequence: number;
  };
  payload: TPayload;
  context: {
    request_id?: string;
    trace_id?: string;
  };
}
```

The shape is illustrative and should be represented with project types.
`payload` is validated against its producer-owned versioned schema.
Envelope metadata must not duplicate payload fields without a clear need.
Secrets, credentials, and unrestricted resource snapshots are prohibited.
Audit change data is limited to the producer's explicit field allowlist.

### 6.3 Versioning and evolution

- The producer keeps each Business Fact contract under `events/vN`.
- A fact's `event_type` remains stable across compatible payload evolution.
  `event_version` selects the schema and consumer mapping.
- A breaking contract change introduces a new versioned contract.
- Consumers handle only versions they explicitly support.
- No global schema registry is part of this design.
- Public OpenAPI versioning is independent from internal fact versioning.

## 7. Producer flow

- A use case receives a command through its normal application entry point.
- The use case loads and changes its own aggregate within its module boundary.
- The aggregate records module-owned Domain Events for meaningful changes.
- The application layer translates selected Domain Events to Business Facts.
- The use case starts an explicit Unit of Work.
- Producer repositories persist business state using that Unit of Work.
- The Outbox writer appends Business Facts using the same Unit of Work.
- The Unit of Work commits business state and Outbox records atomically.
- After commit, the relay can discover the committed Outbox entries.
- The request does not synchronously invoke Audit persistence.
- A failed transaction exposes neither the state change nor its Outbox fact.

## 8. Unit of Work

### 8.1 Contract

- The application layer receives a Unit of Work port.
- The port exposes a bounded transactional operation to the use case.
- The operation provides an opaque transaction context to participating ports.
- The context is passed explicitly to repositories and the Outbox writer.
- The context does not expose a MongoDB `ClientSession` to application code.
- The infrastructure adapter owns session creation, commit, abort, and cleanup.
- The adapter ensures enlisted MongoDB operations use the same session.
- The Unit of Work returns only after commit or reports a transaction failure.

### 8.2 Scope

- One Unit of Work covers one business command's atomic persistence boundary.
- It does not wrap asynchronous consumer execution.
- It does not span an HTTP response and later relay work.
- It does not provide a cross-service distributed transaction.
- A future service split uses local transactions and messaging semantics.
- The current implementation uses MongoDB transactions on a replica set.

### 8.3 Failure behavior

- If an enlisted write fails, the transaction is aborted.
- If commit fails, the use case receives a failure and reports no success.
- The adapter ends the session in all paths.
- No Outbox entry is deliverable before commit succeeds.
- Retrying a business command remains an application-level decision.
- The Outbox writer must not create a second independent transaction.

## 9. Consumer contract and registry

### 9.1 Consumer

- A consumer declares a stable consumer identifier.
- A consumer declares the event types and versions it supports.
- A consumer handles one typed Business Fact at a time.
- A consumer completes only after its durable effect is committed.
- A consumer reports failure when its effect did not complete.
- A consumer deduplicates repeated `event_id` values.

### 9.2 Registry

- The registry is configured at module composition time.
- It maps supported event types and versions to registered consumers.
- It does not discover handlers through arbitrary runtime reflection.
- It does not import producer domain models.
- It invokes only consumers registered for the incoming fact.
- It awaits consumer completion before acknowledging that delivery.
- Unrelated event types are not sent to a consumer.
- Multiple consumers may subscribe to one Business Fact type.
- Each consumer has independent delivery state for a fact.
- A consumer failure does not mark that consumer's delivery successful.
- The registry does not promise a transaction across different consumers.

### 9.3 Initial wiring

- The Audit event handler is the first registered consumer.
- Only explicitly configured producer facts are routed to Audit.
- Additional consumers can be registered without changing producer entities.
- A module must not subscribe by broad wildcard unless deliberately designed.

## 10. Outbox persistence and relay

### 10.1 Stored data

- The Outbox record stores the serialized Business Fact envelope.
- It stores delivery state independently for each consumer.
- It stores attempt count and next eligible retry time per consumer.
- It stores timestamps needed to claim and complete delivery.
- It stores a claim or lease marker if required by the adapter strategy.
- It does not store a producer aggregate as a substitute for the fact.
- The schema remains an infrastructure detail.

### 10.2 Append and dispatch

- The producer appends facts in its transaction through the Outbox writer port.
- Only committed records are eligible for dispatch.
- The relay selects eligible consumer deliveries from the Outbox adapter.
- The registry resolves the consumer for the fact type and version.
- The relay dispatches the fact and awaits the result.
- On success, the relay records delivery completion for that consumer.
- On failure, the relay records a retryable failed delivery.
- A later relay attempt may deliver the same fact again.
- The relay does not delete a fact as soon as one consumer succeeds.

### 10.3 Multiple consumers

- Delivery status is tracked per `(event_id, consumer_id)` pair.
- One consumer's success does not suppress another consumer's delivery.
- A failed consumer can retry without redelivering completed consumers.
- The fact remains available until all registered consumer deliveries complete.
- No assumption is made that all consumers share one transaction.

## 11. Ordering

- Ordering is guaranteed per resource, not across the whole system.
- Each produced fact has a monotonically increasing `resource.sequence`.
- Sequence allocation occurs within the producer's atomic write boundary.
- For one resource and consumer, sequence `N+1` waits while `N` is pending or failed.
- Completion of `N` permits the next sequence for that consumer.
- Different resources may progress independently.
- Different consumers may be at different sequence positions.
- The relay and storage adapter enforce this eligibility rule together.
- A consumer may validate sequence continuity as a defensive check.
  A global total order is not provided.
- Ordering across distinct resources is not meaningful in this contract.

## 12. Retry and idempotency

Delivery is at least once.

- The relay assumes a consumer can finish while its acknowledgement fails.
- The consumer's durable effect and idempotency record must be atomic.
- The deduplication key is the stable `event_id` within a consumer boundary.
- A duplicate successfully processed event returns success without repeating its effect.
- A duplicate in progress must not create a second durable effect.
- A failed attempt remains eligible for a later retry.
  The relay records attempts so delivery state can be inspected operationally.
- Retry timing is an implementation detail within the agreed retry contract.
- No dead-letter queue or manual replay UI is specified.
- Failure in one consumer does not invalidate another consumer's completed effect.

## 13. Audit integration boundary

- Business modules publish facts internally through the Outbox path.
- Audit has no public write endpoint for client-submitted audit records.
- Audit consumes allowed facts and creates append-only Audit records.
- Audit records include actor, action, resource, timestamp, and context metadata.
  Before/after values are limited to explicit field allowlists.
- Audit does not persist unrestricted resource snapshots.
- Audit query APIs read Audit records, not the Outbox.
- The initial public endpoints are read-only and authorization-protected.
- Tenant scoping is not included in the initial Audit version.

## 14. NestJS module composition

- `PlatformEventsModule` registers shared ports and infrastructure adapters.
- `DatabaseModule` remains the owner of database connection configuration.
- The Mongo Outbox adapter uses the existing MongoDB connection.
- Producer modules import the events capability used by their application layer.
- Audit registers its consumer through explicit module composition.
- The root Core module composes platform and business modules.
- The HTTP layer remains independent from event dispatch internals.
- No health endpoint for internal event publishing is required now.

## 15. Microservices transition boundary

- The in-process bus is an infrastructure adapter, not a business contract.
- A future broker adapter can implement the same event delivery port.
- Producer-owned Business Fact contracts can become inter-service messages.
- The Outbox remains the producer-side atomic publication boundary.
- Consumers remain idempotent because delivery can repeat.
- Per-resource ordering remains the required semantic where supported.
- A service split requires explicit network, ownership, and deployment decisions.
- This specification does not choose Kafka, RabbitMQ, or another broker.
- It does not claim an in-process implementation is already distributed.
- Shared database models do not become cross-service contracts.

## 16. Testing strategy

- Tests focus on observable contracts and cross-component behavior.
- The suite has three unit tests, two integration tests, and one critical transaction test.
- The critical MongoDB test runs against a replica set in Docker Compose.
- Tests use isolated test database names and clean up their own data.
- No test depends on an external broker.
- Tests avoid asserting private helper call sequences.
- Tests assert committed state, delivery state, order, and consumer effects.

### 16.1 Unit tests (3)

1. Registry routes a fact only to consumers registered for its type and version.
2. Relay acknowledges only successful delivery and retries a failed consumer.
3. Relay preserves per-resource sequence while independent resources progress.

### 16.2 Integration tests (2)

1. Mongo Outbox adapter persists facts and tracks delivery per consumer.
2. In-process bus, registry, relay, and representative consumer cooperate on success and retry.

### 16.3 Critical transaction test (1)

- Run a producer write through the real Mongo Unit of Work and Outbox adapter.
- On commit, assert business state and the Outbox fact both exist.
- Run the relay and assert the registered consumer receives the fact.
- Force a producer failure before commit and assert neither write remains.
- Write multiple facts for one resource and assert delivery sequence is preserved.
- Use the Compose MongoDB replica set rather than mocked transaction semantics.

### 16.4 TDD sequence

- Write the behavioral test before implementing each boundary.
- Run the focused test and confirm it fails for the intended behavior.
- Implement the smallest production change that makes it pass.
- Run the focused test again, then the platform test set.
- Run lint, typecheck, and build after final integration.
- Do not mirror every private function with a separate test.

## 17. Test runtime configuration

- The integration runtime reads `MONGODB_TEST_URI` from the test environment.
- The URI identifies a MongoDB replica set suitable for transactions.
- The test database is separate from development and production databases.
- Docker Compose starts the replica-set service before integration tests.
- CI waits for the database to accept connections before running the suite.
- The test process closes Mongoose connections and Nest application contexts.
- Local unit tests do not require Docker.
- The repository configuration defines the Compose service name and URI.
- No new test package is required for the selected Compose-based strategy.

## 18. Acceptance criteria

- Domain Events are not shared as cross-module contracts.
- Business Facts are versioned and producer-owned.
- Producer state and its Outbox fact share one successful transaction.
- A rolled-back producer write leaves no deliverable fact.
- A consumer failure remains incomplete and is retryable.
- A successfully processed duplicate does not repeat the consumer effect.
- One consumer's delivery status does not overwrite another's.
- A resource's later sequence waits for earlier delivery completion.
- Different resources are not blocked by one another's sequence.
- Audit persists allowed facts as append-only records.
- No public API allows arbitrary clients to create internal events.
- Unit and integration suites run with the documented test setup.
- The critical transaction test passes against the Compose replica set.
