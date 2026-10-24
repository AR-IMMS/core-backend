# AT-03 Asset Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement persistent registration, reads, and descriptive updates for physical compute Assets, with seeded Node classification, canonical Asset reads for consumers, and transactionally attributed Audit facts.

**Architecture:** Keep Asset rules in the Asset & Topology domain. Split the consumer surface so the Asset query contract is provided in AT-03 without waiting for later Rack and Room-map queries. Use focused application use cases, Mongo adapters, and bounded HTTP controllers; split files further if a controller or use-case file approaches 350–400 LOC or combines unrelated responsibilities.

**Tech Stack:** TypeScript, NestJS, Mongoose, MongoDB migrations, Zod, Jest, existing Platform Unit of Work/Outbox/Audit and HTTP pagination.

**Spec:** `docs/superpowers/specs/2026-10-19-at-03-asset-registry-design.md`

## Global Constraints

- Do not add dependencies or catalog CRUD.
- New Assets use a canonical UUID, lifecycle state `ACTIVE`, and no active placement.
- Asset Type is immutable after creation; Model is optional and must exist and match the Asset Type when set or changed.
- List pagination uses only opaque `cursor` and `page_size`, defaults to 20, caps at 100, and has no filters in AT-03.
- Use `asset:read` for reads and both IT Admin role and `asset:manage` for mutations.
- Persist material Asset changes and append Audit Facts in one Unit of Work; reuse the existing Outbox/Audit consumer.
- Keep module specs in each owning folder's `__tests__/` directory.
- Keep controller and use-case responsibilities cohesive; split files at roughly 350–400 LOC or earlier when multiple responsibilities emerge.

## Review Focus

- Missing or malformed Node Type reference: reject registration without creating an Asset.
- Unknown Model or Model belonging to another Type, on both create and update: reject and preserve the existing Asset.
- Blank/whitespace name and serial values: reject the name; normalize an empty optional serial to absent.
- Invalid cursor or page size, and duplicate IDs across pages: reject invalid input and return deterministic cursor pages.
- Outbox append failure during a material change: roll back the Asset write; a no-op update emits no Audit Fact.
- Non-admin mutation with `asset:manage`, or Admin without that permission: deny before the use case changes state.

---

### Task 1: Split and provide the Asset consumer query contract

**Files:**
- Modify: `src/modules/asset-topology/contracts/asset-topology.contract.ts`
- Modify: `src/modules/asset-topology/contracts/asset-topology.contract.token.ts`
- Modify: `src/modules/asset-topology/contracts/index.ts`
- Create: `src/modules/asset-topology/contracts/__tests__/asset-query-contract.spec.ts`

**Produces:** `AssetTopologyAssetQueries.getAsset(assetId: AssetId): Promise<AssetReference | null>` and token `ASSET_TOPOLOGY_ASSET_QUERIES_PORT`. Keep broad consumer contract types available, but make Asset queries independently injectable from Rack or Room-map providers.

- [ ] Write a failing contract test proving the Asset query type and token are exported independently of Rack and Room-map query types.
- [ ] Run `node_modules/.bin/jest --runInBand src/modules/asset-topology/contracts/__tests__/asset-query-contract.spec.ts` and confirm the missing contract/export fails.
- [ ] Define the focused Asset query interface and token while retaining the existing broad contract types for later query providers.
- [ ] Run the focused Jest command and confirm the contract test passes.

### Task 2: Complete Asset lifecycle and immutable classification rules

**Files:**
- Modify: `src/modules/asset-topology/domain/asset/asset.ts`
- Modify: `src/modules/asset-topology/domain/asset/__tests__/asset.spec.ts`
- Modify: `src/modules/asset-topology/index.ts`

**Consumes:** Existing `Asset.register`, `Asset.rename`, `AssetTypeReference`, and `AssetModelReference`.

**Produces:** `AssetLifecycleState`, default registration state `ACTIVE`, and an immutable descriptive update method preserving Asset ID and Type while allowing name, optional Model ID, and optional serial number changes.

- [ ] Add failing domain tests for `ACTIVE` on registration, Type/ID preservation across updates, optional Model/serial values, invalid names, and a mismatched Model Type.
- [ ] Run `node_modules/.bin/jest --runInBand src/modules/asset-topology/domain/asset/__tests__/asset.spec.ts` and confirm the new lifecycle/update cases fail.
- [ ] Extend the Asset entity with lifecycle state and focused descriptive update behavior. Keep placement outside the entity; do not add maintenance/retirement transitions in AT-03.
- [ ] Run the domain Jest spec and confirm all Asset invariants pass.

### Task 3: Add catalog and Asset Mongo persistence plus Node Type bootstrap

**Files:**
- Create: `src/modules/asset-topology/infrastructure/mongodb/asset.schema.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/mongo-asset.store.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/__tests__/mongo-asset.store.spec.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/migrations/asset-catalog.migration.ts`
- Create: `src/modules/asset-topology/infrastructure/mongodb/migrations/__tests__/asset-catalog.migration.spec.ts`
- Create: `src/modules/asset-topology/application/assets/asset-store.port.ts`
- Create: `src/modules/asset-topology/application/assets/asset-catalog.port.ts`
- Modify: `src/modules/asset-topology/migrations.ts`
- Modify: `src/app/commands/mongo-migrations.registry.ts`

**Produces:** `AssetCatalogStorePort` lookup methods for Type and Model; `AssetStorePort` create/find/list/update methods; Mongo schemas and adapters; idempotent Node Type seed with stable ID `type-node`.

`AssetCatalogStorePort` provides `findType(typeId: string, context?: UnitOfWorkContext): Promise<AssetTypeReference | null>` and `findModel(modelId: string, context?: UnitOfWorkContext): Promise<AssetModelReference | null>`. `AssetStorePort` provides `findById(assetId: string, context?: UnitOfWorkContext): Promise<Asset | null>`, `save(asset: Asset, context: UnitOfWorkContext): Promise<number>` (persist and increment Audit sequence), and `list(input: { afterAssetId?: string; limit: number }): Promise<{ items: readonly Asset[]; hasMore: boolean }>`. Cursor encoding remains outside the persistence port.

- [ ] Write failing adapter tests for Asset mapping, lifecycle persistence, stable ID filters, Model/Type lookup, cursor ordering, audit-sequence increments, and immutable Type storage.
- [ ] Write a failing migration test proving rerunning the catalog migration leaves one stable Node Type record and installs the unique catalog indexes.
- [ ] Run the two focused Jest specs and confirm they fail before their adapters/migration exist.
- [ ] Implement catalog and Asset schemas, repository ports/adapters, unique canonical ID constraints, non-unique optional serial storage, and the idempotent Node Type migration. Do not insert a Model catalog record unless specified seed data exists.
- [ ] Register the migration through the module's migration export and application migration registry.
- [ ] Run the two focused Jest specs and confirm mappings, indexes, and migration behavior pass.

### Task 4: Implement Asset registration and descriptive update use cases

**Files:**
- Create: `src/modules/asset-topology/application/assets/asset-registration.use-case.ts`
- Create: `src/modules/asset-topology/application/assets/asset-update.use-case.ts`
- Create: `src/modules/asset-topology/application/assets/__tests__/asset-write.use-case.spec.ts`

**Consumes:** Task 2 `Asset` entity; Task 3 store/catalog ports; `UnitOfWorkPort`, `OutboxWriterPort`, and request-context/audit patterns from AT-01.

**Produces:** `RegisterAssetUseCase.execute(input: RegisterAssetInput, actor: AssetActor): Promise<Asset>` and `UpdateAssetUseCase.execute(assetId: string, input: UpdateAssetInput, actor: AssetActor): Promise<Asset>`.

- [ ] Write failing use-case tests for registration with and without optional data, missing Node Type, invalid Model, mismatched Model Type, update preserving ID/Type, update Model validation, no-op audit suppression, and atomic rollback when Outbox append fails.
- [ ] Run `node_modules/.bin/jest --runInBand src/modules/asset-topology/application/assets/__tests__/asset-write.use-case.spec.ts` and confirm the behaviors fail.
- [ ] Implement focused write use cases. Generate IDs with `randomUUID()`. In a Unit of Work, validate references, persist the Asset, allocate its Audit sequence, and append one `audit.fact` for each material change.
- [ ] Run the focused use-case spec and confirm all write and rollback cases pass.

### Task 5: Implement Asset reads and cursor pagination

**Files:**
- Create: `src/modules/asset-topology/application/assets/asset-query.use-case.ts`
- Create: `src/modules/asset-topology/application/assets/__tests__/asset-query.use-case.spec.ts`
- Modify: `src/modules/asset-topology/application/assets/asset-store.port.ts`
- Modify: `src/modules/asset-topology/infrastructure/mongodb/__tests__/mongo-asset.store.spec.ts`

**Consumes:** Task 1 Asset query contract and Task 3 `AssetStorePort`.

**Produces:** `GetAssetUseCase.execute(assetId: AssetId): Promise<AssetReference | null>` and `ListAssetsUseCase.execute(input: { pageSize: number; afterAssetId?: string }): Promise<{ assets: readonly Asset[]; nextCursorAssetId: string | null }>`. `GetAssetUseCase` implements `AssetTopologyAssetQueries` and maps no placement to `currentPlacement: null`.

- [ ] Write failing query tests for canonical Asset mapping, absent Asset, unplaced null placement, cursor ordering, page-size forwarding, and next-cursor behavior.
- [ ] Run the focused Asset query spec and confirm the cases fail.
- [ ] Implement ID lookup and stable ID-ordered cursor pagination with no filter arguments. Encode/decode the HTTP cursor at the presentation boundary using the same opaque-cursor convention as existing paginated APIs.
- [ ] Run the focused query spec and Mongo adapter spec and confirm both pass.

### Task 6: Add Asset registry controllers and OpenAPI

**Files:**
- Create: `src/modules/asset-topology/presentation/assets/asset-write.controller.ts`
- Create: `src/modules/asset-topology/presentation/assets/asset-read.controller.ts`
- Create: `src/modules/asset-topology/presentation/assets/asset-registry.schemas.ts`
- Create: `src/modules/asset-topology/presentation/assets/__tests__/asset-write.controller.spec.ts`
- Create: `src/modules/asset-topology/presentation/assets/__tests__/asset-read.controller.spec.ts`
- Modify: `src/modules/asset-topology/__tests__/asset-topology.module.spec.ts`
- Modify: `src/modules/asset-topology/asset-topology.module.ts`
- Modify: `api/v1/asset-topology.yaml`

**Consumes:** Tasks 4–5 use cases and Task 1 Asset query contract.

**Produces:** `POST /assets`, `GET /assets`, `GET /assets/{asset_id}`, and `PATCH /assets/{asset_id}`. Create body is `{ name, asset_type_id, model_id?, manufacturer_serial_number? }`. Patch accepts optional `name`, `model_id`, and `manufacturer_serial_number`; omitted fields are unchanged and explicit `null` clears the optional Model or serial value. Asset Type is not patchable. List query parameters are `cursor` and `page_size` only; response uses the platform cursor pagination envelope.

- [ ] Write failing HTTP/controller tests for exact create/patch fields, omitted-versus-null update behavior, roles/permissions, response serialization, opaque cursor handling, invalid page size/cursor, and standard not-found mapping.
- [ ] Run the focused controller specs and confirm expected route behavior fails.
- [ ] Add separate write/read controllers and strict Zod request/query schemas. The list query schema accepts only optional `cursor` and `page_size`, applies shared defaults/bounds, and rejects unknown keys. Require `asset:read` for reads and both IT Admin role and `asset:manage` for writes. Add module providers for focused Asset query, write/read use cases, and persistence ports.
- [ ] Bind `ASSET_TOPOLOGY_ASSET_QUERIES_PORT` to the Asset query implementation and verify the module provides the Asset reference independently of Rack and Room-map providers.
- [ ] Update OpenAPI with schemas, route permissions, `page_size` default 20/max 100, optional opaque `cursor`, no list filters, and standard envelopes/errors.
- [ ] Run the controller/module Jest specs and parse the OpenAPI YAML.

### Task 7: Verify Asset Audit delivery and full AT-03 behavior

**Files:**
- Create: `test/asset-topology-assets.integration.ts`
- Modify: `package.json`
- Modify: `docs/local/specs/spec-004--asset-topology-module.md` only if implementation uncovers a source-of-truth clarification required by the approved design.
- Modify: `.scratch/ticket-drafts/asset-topology/tickets.md` to mark only verified AT-03 criteria complete.

**Consumes:** Tasks 1–6.

- [ ] Add an integration case proving Asset state and Audit Outbox facts commit atomically and a failed append rolls back the Asset change.
- [ ] Add a delivery case proving Asset registration/update facts are consumed by the existing Audit consumer with correct actor, source, time, and per-Asset sequence.
- [ ] Run `node_modules/.bin/jest --runInBand src/modules/asset-topology` and the existing Core module spec.
- [ ] Run `node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit`, `node_modules/.bin/eslint "{src,apps,libs,test}/**/*.ts"`, `node node_modules/prettier/bin/prettier.cjs --check "src/**/*.ts" "test/**/*.ts"`, and `node_modules/.bin/nest build`.
- [ ] Run `node_modules/.bin/ts-node -r tsconfig-paths/register test/asset-topology-assets.integration.ts` when the isolated replica-set test database is available; otherwise report it as unverified.
- [ ] Review the staged diff, update the local AT-03 ticket checklist, and commit only the AT-03 files.
