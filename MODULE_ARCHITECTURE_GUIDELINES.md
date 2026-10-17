# AR-IMMS — Module Architecture Guidelines

> **Scope:** `core-backend/src`. This document guides humans and AI coding agents on **where code belongs, how modules communicate, and when to introduce abstractions**.
>
> **Status:** Project convention for new development; not a mandate to refactor working modules.
>
> **Relationship to other rules:** This document supplements, and does not modify or override, `AGENTS.md`, `AI_CODING_POLICY.md`, business specifications, or established API contracts. In a conflict, follow repository instructions and approved specifications; surface the conflict rather than silently rewriting architecture.

## 1. Architectural stance

Use a **Modular Monolith + Clean Architecture + capability-based Vertical Slicing (hybrid)**.

Optimize for **discoverability, code locality, readability, testability, maintainability, and incremental extension**. Architectural boundaries matter more than identical folder trees. **Create folders and abstractions only when justified by actual behavior or dependencies.** Never add files solely to make a module resemble a template.

- A **module** owns a bounded business context and its invariants/data lifecycle.
- A **capability** groups related behavior within a module (for example `authentication`, `assignment`, `ticket-lifecycle`).
- **Layer boundaries remain visible**; organize `application/` and `presentation/` by capability. `domain/` and `infrastructure/` may remain module-level when shared by multiple capabilities.
- A **use case** owns one primary business outcome. Several use cases may reuse a domain policy or application port without being merged into a giant service.

## 2. Top-level layout

```text
src/
├── main.ts                         # Bootstrap HTTP server / global HTTP setup.
├── instrumentation.ts              # Initialize OTel before app bootstrap.
├── app/                            # Host/composition root and process-level jobs.
│   ├── core.module.ts              # Assemble platform + business modules.
│   └── jobs/                       # Process-level schedulers; no business rules.
├── platform/                       # Reusable domain-agnostic technical capabilities.
│   ├── config/                     # Environment validation/configuration.
│   ├── database/                   # Connections, transaction infrastructure.
│   ├── events/                     # Outbox, UoW, generic messaging facilities.
│   ├── http/                       # Standard HTTP errors, response, validation.
│   ├── observability/              # Logging/tracing/metrics infrastructure.
│   └── health/                     # Infrastructure readiness/health.
├── shared/                         # Thin shared *business* primitives ONLY when
│                                   # multiple modules truly share semantics.
└── modules/                        # Bounded business contexts (IAM, Ticket, etc.).
```

**Ownership check:** `platform/` has no IAM/Ticket/Incident-specific business rules. `shared/` is not a miscellaneous helpers directory. Business policies live in the owning module.

## 3. Standard business module reference

**Illustrative, not mandatory scaffolding.** Omit optional directories/files when unnecessary. Co-locate `*.spec.ts` beside the code under test.

```text
src/modules/<module-name>/
├── contracts/                            # PUBLIC module boundary; only what
│   │                                     # another module needs to depend on.
│   ├── <module>-api.port.ts              # Public sync API interface, IF needed.
│   ├── <module>.tokens.ts                # Public DI tokens, IF needed.
│   ├── dto/                              # Cross-module request/result types only.
│   ├── events/                           # Published integration event contracts,
│   │                                     # versioned when compatibility requires.
│   └── index.ts                          # Explicit public contract exports.
│
├── domain/                               # Pure business model + invariants.
│   ├── <aggregate>.ts                    # Entity/aggregate when there is state
│   │                                     # and behavior to protect.
│   ├── <policy>.ts                       # Business rules shared by use cases.
│   ├── <value-object>.ts                 # Domain value objects when useful.
│   ├── events/                           # Internal domain events, optional.
│   └── errors/                           # Domain errors, not HTTP exceptions.
│
├── application/                          # Business use-case orchestration.
│   ├── <capability-a>/                   # Feature-oriented code locality.
│   │   ├── <action>.use-case.ts          # Single entry point / primary outcome.
│   │   ├── <capability>.service.ts       # Optional: significant shared orchestration.
│   │   └── ports/                       # Ports used only by this capability.
│   │       └── <dependency>.port.ts      # Interface + DI token may share a file.
│   ├── <capability-b>/                   # Add only when distinct behavior exists.
│   ├── ports/                            # Ports shared across capabilities.
│   ├── handlers/                         # Optional: application event handlers.
│   └── processes/                        # Optional: long-running workflow
│                                         # coordinators with explicit state.
│
├── infrastructure/                       # Driven adapters; details of I/O.
│   ├── mongodb/                          # Mongoose schemas, stores, DB mapping.
│   ├── adapters/                         # External services / other module APIs.
│   ├── messaging/                        # Publishing/messaging transports.
│   └── ...                               # JWT, hashing, rate limiting, etc.
│
├── presentation/                         # Driving/inbound adapters.
│   ├── <capability-a>/                   # Controller + HTTP schema (+ tests).
│   │   ├── <capability>.controller.ts    # Parse request, invoke use case,
│   │   │                                 # map response; no business workflow.
│   │   └── <capability>.schema.ts        # HTTP-specific Zod schemas.
│   ├── guards/                           # Guards shared by module routes.
│   └── consumers/                        # Inbound delivery adapters, only
│                                         # dispatch to application handlers.
│
├── <module>.module.ts                    # NestJS DI composition and exports.
├── index.ts                              # Public module class + contracts only;
│                                         # NEVER export internals broadly.
└── README.md                             # Ownership, capability map, public API,
                                          # dependencies, main workflows.
```

**Small module rule:** A straightforward module may keep just a few flat files per layer (or omit a layer that adds no value). Do **not** create empty `contracts/`, `ports/`, `dto/`, `handlers/`, etc. A tiny health endpoint is not a reason to create a full directory hierarchy.

## 4. Dependency and visibility rules

1. `domain/` is **pure TypeScript**: no NestJS, HTTP, MongoDB/Mongoose, network, external SDK, or application imports.
2. `application/` may depend on its module's `domain/`, internal ports and public contracts, but **must not** import concrete infrastructure or presentation classes.
3. `infrastructure/` may import domain types and application ports to implement them; it must not decide business transitions or orchestrate a workflow.
4. `presentation/` may invoke application entrypoints and use HTTP/event transport libraries; it must not directly mutate persistence or embed domain workflows.
5. `app/` assembles modules and schedules process-level work; `platform/` is domain-agnostic.
6. **Between business modules**, imports go only through the other module's published `contracts/` or public entrypoint. No deep imports from another module's `domain/`, `application/`, `presentation/`, or `infrastructure/`.
7. Public contract types must not depend on internal domain/persistence implementations or NestJS/Mongoose. An exported **DI token** may be a plain `Symbol` and is not an excuse to expose a concrete service.
8. Keep the `index.ts` exports intentionally small. Avoid barrel files inside implementation folders when they obscure import paths or cause cycles.
9. No circular module dependencies; avoid `forwardRef()` as an architectural workaround. Resolve ownership, direction of invocation, or use events/read models.

**Clarification:** A controller implementing an inbound protocol is not an implementation of an application outbound port. Public module API facades/adapters should delegate to application use cases and be wired at the module composition root; do not force them into `presentation/` merely because they are entry points.

## 5. Choosing the correct home for code

| Responsibility | Default location | Not here |
|---|---|---|
| Invariant / transition / domain decision | Owning module `domain/` | Controller, Mongo store |
| Business action / transaction orchestration | `application/<capability>/` | Infrastructure adapter |
| Internal storage/SDK interface | `application/.../ports/` (or module-level `application/ports/` when shared) | Public `contracts/` |
| Concrete Mongo/Zammad/crypto implementation | `infrastructure/` | Domain, application |
| REST validation/request/response | `presentation/<capability>/` | Cross-module `contracts/dto/` |
| Cross-module callable API/types/events | `contracts/` | Importing another module's internal classes |
| Inbound event transport dispatch | `presentation/consumers/` or a dedicated inbound adapter | Business workflow in transport callback |
| Event-triggered business reaction | `application/handlers/` or relevant capability | Consumer transport glue |
| Aggregated read across modules | `operational-context` / explicit read-model owner | Cross-module DB queries from random services |

**Only introduce a port when there is a real architectural boundary** (DB, external API, nondeterministic service, cross-module public API, or a meaningful testing seam). Do not create an interface/token/facade/mapper chain for a simple internal method call. Port and token may live together:

```ts
export interface PasswordHasher {
  hash(value: string): Promise<string>;
  verify(hash: string, value: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
```

## 6. Capability naming and growth

Name capabilities after **business behavior**, not vague technical nouns: `authentication/`, `session-management/`, `user-administration/`, `ticket-lifecycle/`, `assignment/`, `linking/`, `investigation/`, `resolution/`.

- Prefer `<verb>-<object>.use-case.ts`, `<name>.port.ts`, `mongo-<resource>.store.ts`, `<capability>.controller.ts`, with specs beside implementation.
- Start flat when a capability has one or two files. Add a folder when grouping improves navigation.
- Split a capability when it contains separate clusters of independently changing behavior (e.g. authentication versus session management), **not** by arbitrary file count.
- When multiple capabilities share a rule, put **business semantics** in `domain/<policy>.ts` or a clearly named domain service; put genuinely shared orchestration/ports in `application/` at module level.
- Keep files focused; use approximately **300–400 LOC as a review signal**, not a hard mechanical split rule.

## 7. Edge cases and decisions

### 7.1 Use case spans multiple capabilities

**Rule:** Place it with the module/capability owning the **primary business outcome**. It can consult local domain policies and call other module public APIs through ports/adapters. Never move a domain invariant into a shared utility merely to resolve placement.

**Example:** `ResolveIncidentUseCase` remains in `incident/application/resolution/`; verifying maintenance evidence does not transfer ownership of the incident lifecycle to Maintenance.

### 7.2 Circular cross-module workflow

**Example:** Incident invokes Ticket creation; Ticket needs to validate an Incident reference.

- Keep each module authoritative for its own state and validation.
- Use stable, typed references (`{ type, id }`) and public APIs, not shared persistence models.
- Avoid a synchronous call cycle. Let a clear initiator orchestrate, provide a narrow validation query via a public API, or use asynchronous workflow handling where appropriate.
- Public contracts must not import one another recursively merely to reuse a DTO.

### 7.3 External side effects and partial failures

**Example:** Zammad ticket creation succeeds but Core Mongo business-extension persistence fails.

- **Never assume** one DB transaction covers another DB, Zammad, Grafana, or AI.
- Specify idempotency keys, failure states, retry/reconciliation behavior, and what source is authoritative.
- Prefer writing recoverable state before irreversible external actions when feasible; choose compensation only if its semantics are safe.
- Keep transport retries in infrastructure, but business recovery decisions in application workflows.

### 7.4 Cross-module queries

Do not reach into other modules' Mongo collections for convenience. Use their public query contracts for small reads; for frequent composite dashboard/AR views, build an explicit projection/read model in `operational-context` or another designated owner. Document consistency expectations.

### 7.5 Contracts that grow over time

Export the smallest stable API a real consumer needs; avoid generic `getEverything()` DTOs. Separate HTTP contracts from module contracts. Introduce versioned public events when breaking downstream consumers. Do not version private application types without cause.

### 7.6 Giant services and duplicated policies

If a service performs login, session refresh, provisioning and presence updates, split by capability. If multiple use cases repeat the same invariant, extract a domain policy, not a global `CommonService`. Reuse low-level technical implementation within infrastructure where appropriate.

### 7.7 Mixed read/write workflows

An application query may use a purpose-built read port/projection without reconstructing full domain aggregates. **Writes that change domain state must enforce invariants through the owning module.** This is selective CQRS, not a mandate to create command/query infrastructure for every endpoint.

### 7.8 Authorization and audit

IAM exposes identity/permission capability; **the owning business module enforces resource-specific policies** (e.g. who may close a particular ticket). Auditing occurs through agreed platform events/contracts; avoid coupling domain logic directly to an Audit repository.

## 8. AI implementation workflow — REQUIRED

Before adding or modifying files:

1. **Inspect the repository:** relevant `README.md`, `AGENTS.md`, `AI_CODING_POLICY.md`, existing module pattern, specs/contracts, tests, and Git status. Respect the current repo state; do not silently alter unrelated work.
2. **State ownership:** identify the business module, capability, primary use-case outcome, and existing domain invariants.
3. **Trace existing flow:** controller/consumer → use case → domain policy/ports → adapter → persistence/external service. Reuse existing terms and boundaries.
4. **Choose minimum structure:** prefer editing existing files and creating only required contracts, ports, adapters, mappings, and folders. Avoid speculative abstractions.
5. **Check dependencies:** no forbidden layer imports, cross-module deep imports, cycles, or domain framework dependencies.
6. **Define failure paths:** validation errors, authorization, retries, idempotency, partial external failure, and consistency as relevant.
7. **Test at appropriate seams:** domain invariants; application orchestration with port fakes; adapters with focused integration tests; controller contract/integration tests. Keep specs co-located.
8. **Update navigation docs:** module README/capability map or public contract note when adding/changing a meaningful workflow or boundary.
9. **Report changes:** mention file placement rationale, affected contracts, tests executed, and remaining risks. Do not claim tests passed unless actually run.

### Review checklist

- [ ] Correct module owns the state and business decision.
- [ ] Capability is named after behavior and is easy to locate.
- [ ] No unnecessary abstractions / folders / base classes / generic services.
- [ ] Domain has no framework or persistence coupling.
- [ ] No cross-module internal imports or dependency cycles.
- [ ] `contracts/` contains only real public surface; API schemas stay at transport boundary.
- [ ] External failures and idempotency are explicitly addressed where needed.
- [ ] Important behavior has focused tests; docs reflect changed boundary.

## 9. Migration policy

- **New modules:** follow this reference from the start, choosing only necessary folders.
- **Existing IAM/Audit/Platform code:** do **not** bulk-refactor simply to match this tree. Refactor incrementally when changing related behavior or when a demonstrable navigation/coupling problem exists; maintain API compatibility and regression tests.
- **Exceptions:** a justified departure from folder placement is acceptable when it improves clarity without violating ownership/dependency rules. Document the reason in the PR or module README.

## 10. Quick examples

```text
# Simple business module — flat is fine.
modules/example/
├── application/get-example.use-case.ts
├── presentation/example.controller.ts
├── example.module.ts
└── README.md

# Complex business module — group behavior within layers.
modules/ticket/
├── contracts/                       # Other modules interact here.
├── domain/                          # Ticket state and business policies.
├── application/
│   ├── ticket-lifecycle/            # Create/close/reopen.
│   ├── assignment/                  # Owner/assignee changes.
│   ├── linking/                     # Typed business references.
│   └── ports/                       # Zammad provider, extension store.
├── infrastructure/
│   ├── zammad/                      # Zammad is authoritative for Ticket state.
│   └── mongodb/                     # Core business extension and identity mapping.
├── presentation/
│   ├── tickets/                     # REST transport schemas and controllers.
│   └── linking/
├── ticket.module.ts
└── README.md
```

**Decision rule:** If unsure where code should go, choose the owning business outcome first, then the appropriate layer, then the smallest useful capability grouping. Prefer a simple, explicit dependency over a new abstraction whose purpose cannot be explained.
