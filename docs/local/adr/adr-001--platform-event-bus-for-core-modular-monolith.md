# ADR-001: Platform Event Bus for the Core Modular Monolith

- **Status:** Accepted; implementation pending
- **Date:** 2026-10-07
- **Scope:** Internal event delivery between Core modules

## Context

The Core backend is a modular monolith.
IAM, Asset & Topology, and Audit are the first planned modules.
Modules need to communicate without sharing domain models.
Audit must record business changes asynchronously.
A successful business write must not lose its corresponding audit fact.
MongoDB is the current database adapter.
The current runtime is one deployable application.
A broker is not required for the current deployment.
The design should retain boundaries that can later map to services.

## Decision

Use a platform-owned Event Bus for internal event delivery.
Keep Domain Events private to their owning module.
Translate selected Domain Events into versioned Business Facts.
Use Business Facts as the cross-module event contracts.
Keep each Business Fact schema with its producing module.
Use one shared, business-neutral `audit.fact` contract for Audit effects.
Have producers supply actor, action, resource, context, and allowlisted changes.
Do not map producer-specific Business Facts into Audit records.
Use an in-process transport for the modular-monolith deployment.
Keep transport-neutral application ports around event delivery.
Persist Business Facts in an Outbox with the business write.
Use an explicit Unit of Work for writes that include Outbox entries.
Keep database sessions and driver types inside infrastructure adapters.
Deliver Outbox entries at least once.
Require consumers to make their effects idempotent.
Preserve processing order for each resource.
Allow different resources to progress independently.
Make Audit the initial consumer of the shared `audit.fact` contract.
Use MongoDB transactions for the current MongoDB adapter.
Run transaction tests against a MongoDB replica set in Docker Compose.
Treat the Outbox as a delivery buffer, not an event store.
Use Audit records as the durable query source for Audit history.
Do not expose a public endpoint for clients to publish internal facts.

## Rationale

Domain Events express implementation-level state changes within a module.
Business Facts express stable facts intended for other modules.
Separating them prevents consumers from depending on producer aggregates.
Versioned contracts make schema evolution explicit and reviewable.
Producer ownership keeps contract changes close to producer behavior.
An in-process transport keeps the initial runtime simple.
Ports keep application behavior independent from the transport choice.
The Outbox closes the gap between a database commit and publication.
The Unit of Work makes the atomic persistence boundary explicit.
Hiding sessions keeps database details out of application code.
At-least-once delivery avoids promising exactly-once effects across boundaries.
Idempotency makes redelivery safe after process failure or acknowledgement loss.
Per-resource ordering preserves meaningful sequence without global serialization.
Audit is the first real consumer for validating the pattern.
MongoDB transactions require a replica-set-capable test environment.

## Alternatives considered

### Direct in-process publish after saving business state

Rejected because a process failure can occur before publication.
Committed business state could exist without its Audit fact.

### Publish before saving business state

Rejected because consumers could observe a fact for a failed write.

### Use Domain Events as cross-module contracts

Rejected because this exposes producer implementation details.
It would make domain refactoring disruptive to consumers.

### Add a broker immediately

Deferred because the application is a single deployable monolith today.
A broker adds infrastructure and operations before a need is established.
The transport port leaves room for a later broker adapter.

### Treat the Outbox as the permanent event log

Rejected because delivery state and Audit history serve different purposes.
Audit records are the durable source for Audit queries.

### Require exactly-once delivery

Rejected because consumer effects cannot be atomically committed with delivery state.
At-least-once delivery with idempotent consumers is the chosen contract.

### Share MongoDB sessions with application handlers

Rejected because it couples application behavior to a database driver.
The Unit of Work owns transaction setup and completion.

## Consequences

The producer writes business state and its Outbox fact in one transaction.
The producer owns Domain Event translation and Business Fact versioning.
Consumers must tolerate receiving the same fact more than once.
The Outbox adapter tracks delivery state per consumer.
The relay cannot process a later resource sequence before an earlier pending one.
Transactional MongoDB deployments need replica-set support.
Local development and CI need a repeatable replica-set Compose service.
The first version includes persistence and relay behavior beyond an in-memory bus.
The Audit consumer accepts only the shared, versioned `audit.fact` contract.
Outbox retention and cleanup policy remain operational decisions.
No broker, replay system, schema registry, or event sourcing is introduced.
A move to microservices requires later deployment and transport decisions.
Business Fact contracts and consumer idempotency remain applicable.

## Implementation notes

The proposed platform boundary is `src/platform/events`.
Producer Domain Events remain under `src/modules/<producer>/domain/events`.
Producer Business Facts live under `src/modules/<producer>/contracts/events/v1`.
The shared Audit Fact contract lives under `src/platform/events/contracts`.
Translation lives in the producer application layer.
Audit consumption lives under `src/modules/audit/infrastructure/events`.
Mongo-specific Outbox storage lives in platform infrastructure.
Platform exports ports and contracts, not Mongoose models.
The initial test suite has three unit, two integration, and one transaction test.

## References

- Core architecture: modular monolith with domain, application, presentation, and infrastructure boundaries.
- Audit API: query-only public endpoints; writes arrive through internal events.
- API baseline: versioned public REST contracts and Problem Details responses.
