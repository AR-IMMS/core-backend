# Repository guidance for AI agents

## Start with the repository state

- Read `README.md`, then inspect the files and tests relevant to the request. Check `git status` before editing and preserve unrelated user changes, including untracked files.
- This repository is in its foundational bootstrap phase. Treat checked-in code as implemented behavior; treat accepted designs whose status says implementation pending as plans, not existing capabilities.
- If requirements conflict with the code, API contracts, or accepted design documents, identify the conflict and ask for clarification rather than inventing product behavior.
- Keep changes scoped to the request. Do not refactor adjacent code, add dependencies, or change public contracts without a clear need in scope.
- For a large change or one spanning multiple modules, first map the affected boundaries, split the work into reviewable steps, and identify dependencies between them. Keep each step within its owning module; coordinate cross-module changes through their public contracts and update the relevant documentation with each behavior or contract change.

## Architecture and ownership

- This is a NestJS modular monolith using Modular Clean Architecture. `src/app` composes the application, `src/modules` is for business modules, `src/platform` owns application-wide technical capabilities, `src/shared` is only for genuinely shared primitives, and `src/main.ts` is the entry point.
- A business module owns its domain, application, presentation, and infrastructure concerns. Keep domain code independent of NestJS, MongoDB, and other frameworks; application use cases depend on ports, with infrastructure adapters implementing them.
- Do not reach into another module's internal repositories, services, domain models, or persistence. Cross-module collaboration must use a public application contract or an explicitly defined internal event contract.
- Do not move module-specific business logic into `platform` or `shared` for convenient imports. Keep framework/database details in infrastructure and compose modules at the application boundary.
- `docs/adr/adr-001--platform-event-bus-for-core-modular-monolith.md` and `docs/specs/spec-001--platform-events.md` describe the platform event bus design.

## Code and change conventions

- Follow the local TypeScript/NestJS patterns and aliases in `tsconfig.json` (`@/`, `@modules/`, `@platform/`, `@shared/`). Keep exports intentional through existing package `index.ts` files.
- Use the configured Prettier and ESLint rules. The checked-in `.prettierrc` requires single quotes and trailing commas; `eslint.config.mjs` enables type-aware TypeScript linting and Prettier integration. Do not add blanket `any` usage; preserve meaningful types even though the current lint rule does not forbid explicit `any`.
- Add or update tests for changed behavior, following the neighboring `*.spec.ts` and `*.e2e-spec.ts` patterns. Unit tests do not require Docker; tests that rely on MongoDB transactions need the replica-set setup documented by the relevant spec/README.
- Keep `pnpm-lock.yaml` in sync with intentional dependency changes. Use the repository-pinned Node.js and pnpm versions from `package.json` / `.nvmrc`; do not switch package managers.
- When public HTTP API behavior or schemas change, update the relevant OpenAPI source under `api/` in the same change. `api/baseline.yaml` holds reusable contract components; concrete API contracts live under `api/vN/`. Public REST paths use `/api/v1`; preserve the response and error conventions implemented under `src/platform/http`.
- When business behavior changes, update the corresponding business flow/spec source of truth so business analysts (BA) can review the behavior without reading code. Update the README for setup changes and the relevant ADR/spec when an accepted architectural decision changes. Do not duplicate long business or architecture specifications in this file.

## Verification

- Install from the lockfile with `pnpm install --frozen-lockfile` when dependencies need setup.
- For focused changes, run the relevant Jest test(s), then `pnpm typecheck` and `pnpm build` as appropriate. Before finalizing a broader change, use the non-mutating CI lint command `pnpm exec eslint "{src,apps,libs,test}/**/*.ts"`, `pnpm test:cov --runInBand`, and `pnpm build`.
- `pnpm lint` includes ESLint `--fix` and can modify files. Do not use it as a check-only command; prefer the CI lint command above. `pnpm format:check` is the non-mutating Prettier check for `src/**/*.ts` and `test/**/*.ts`.
- Run `pnpm test:e2e` only when the change affects an e2e-covered path and its required services/configuration are available. Do not claim an integration or transaction path is verified by unit tests alone.
- CI also runs `pnpm audit --ignore-unfixable --audit-level moderate`; use it when dependency changes make the audit relevant. Report checks that could not be run and why.

## Repository map

- `src/`: application entry point, composition, business modules, shared primitives, and platform capabilities.
- `api/`: OpenAPI contracts.
- `docs/`: business flows/specs, architecture decisions, and detailed design documents.
- `test/`: end-to-end test configuration and tests.
- `.github/workflows/`: CI workflows.

## Sources of truth

Read the relevant source before changing behavior:

- Business flows and acceptance criteria: `docs/business/`
- Architecture and module boundaries: `docs/architecture/`
- Accepted decisions: `docs/adr/`
- Detailed feature specifications: `docs/specs/`
- Public API contracts: `api/`

If sources conflict, describe the conflict and ask for clarification. Do not treat planned designs as implemented behavior.

## Before implementation

- For a business behavior change, read the relevant business flow and spec.
- For a cross-module change, read the architecture and relevant ADRs.
- For an HTTP API change, read and update the OpenAPI contract.
- For setup or tooling changes, read the development setup guide.
