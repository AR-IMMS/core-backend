# Core Backend

The Core Backend serves as the monolith backend for AR-IMMS. This repository focuses on shared business domains for identity, asset, and topology management, along with business change history. Telemetry/observability systems and AI services reside outside this repository; Core integrates with them through well-defined contracts.

> The repository is currently in its foundational bootstrap phase. Business modules will be added incrementally in vertical slices, complete with tests and corresponding contracts.

## Initial Scope

- **IAM** — Identity, authentication, and authorization.
- **Asset & Topology** — Infrastructure assets and their relationships.
- **Audit** — Tracking business changes requiring traceability.

## Architecture

Modular Clean Architecture is applied. Each business module owns its respective domain, application, presentation, and infrastructure layers. `platform` contains application-wide technical capabilities; `shared` is strictly reserved for truly shared types or utilities and contains no module-specific business logic.

```text
src/
├── app/          # Composition root and CoreModule
├── modules/      # IAM, Asset & Topology, Audit
├── platform/     # Config, HTTP, database, logging, health, event bus...
├── shared/       # Minimal kernel, shared primitives
└── main.ts       # Application entry point
```

A module is typically structured as follows:

```text
src/modules/<module>/
├── domain/
├── application/
├── presentation/
└── infrastructure/
```

The `domain` layer has no dependencies on NestJS, MongoDB, or external frameworks. The `application` layer orchestrates use cases via ports/interfaces. The `presentation` layer receives and translates external requests. The `infrastructure` layer implements adapters such as repositories and technical integrations.

## API and Communication

- REST/JSON is the primary API protocol; public APIs start under the `/api/v1` prefix.
- OpenAPI serves as the API description contract. The current baseline resides at [`api-baseline.yaml`](https://www.google.com/search?q=./api-baseline.yaml); update the contract alongside API changes.
- SSE (Server-Sent Events) is used for real-time alert/incident updates pushed to dashboards.
- Internal event schemas are defined within Core first; internal events are not yet treated as external integration contracts.
- gRPC is reserved for specific future needs and is not the default protocol.

## Toolchain

| Component  | Base Version |
| ---------- | ------------ |
| Node.js    | `22.22.3`    |
| pnpm       | `11.9.0`     |
| NestJS     | `11`         |
| TypeScript | `5.9.3`      |

Keep `pnpm-lock.yaml` tracked in Git and install dependencies using `pnpm install` to ensure a consistent dependency graph across machines. Use `pnpm install --frozen-lockfile` in CI.

## Getting Started

```bash
pnpm install
pnpm start:dev
```

Common verification commands:

```bash
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

If the project defines `format:check` or `typecheck` scripts, run them before opening a Pull Request. `lint` should be used for checks only; use `lint:fix` when you want to automatically format or fix fixable issues.

## Branches and Commits

Main branches:

- `main` — Release branch.
- `dev` — Integration branch.
- `feat/<short-name>` — Features.
- `bug/<short-name>` — Bug fixes.
- `test/<short-name>` — Test-focused work.
- `epic/<short-name>` — Optional, used to group related features.

Commit messages follow Conventional Commits; Husky runs Commitlint via the `commit-msg` hook.

```text
feat: add core bootstrap
feat(iam): add user module skeleton
fix(asset): validate parent relationship
test(audit): cover event mapping
docs: clarify local setup
chore: configure commit hooks
ci: run checks on pull requests
```

Pull requests should target `dev`, including a brief description of changes and test results. Merge into `main` only when preparing for a release.

## Development Principles

- Prioritize small, explainable changes backed by appropriate tests.
- Prevent modules from directly accessing internal parts of other modules; communication must occur via public application contracts or defined internal events.
- Do not place business logic into `shared` or `platform` purely for convenience of importing.
- Update OpenAPI, README, or related documentation within the same Pull Request whenever contracts or setup instructions change.
- Avoid adding abstractions before an actual use case explicitly requires them.
