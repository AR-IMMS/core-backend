## AT-FLOW1: Complete Flow 1 — Infrastructure Asset Management

**Published:** [#34](https://github.com/AR-IMMS/core-backend/issues/34)

**Suggested labels:** `type:feature`, `scope:backend`, `scope:frontend`

**Source:** `docs/local/specs/spec-004--asset-topology-module.md`; `docs/shared/business/01-infrastructure-asset-management.md`; existing `src/modules/asset-topology/domain/`
**Review status:** approved

**Goal**

Deliver Flow 1 end-to-end: an IT Admin can establish the physical topology, register Nodes, place or unmap them, identify Racks and Nodes by QR, print labels, track maintenance state, and retire eligible Assets/Racks. The required UI and cross-module interactions must work through public contracts.

**Flow 1 completion criteria**

- The system provisions the default Data Center; Admin can create Sites and Rooms under it, configure the Room map, and place Racks.
- Admin can register an Asset (type Node), leave it unassigned, place it in one U, move it, and unmap it with history retained.
- Rack and Node QR identifiers resolve to the correct canonical records; labels can be generated and printed.
- Maintenance state follows Maintenance Activity, with the agreed manual fallback.
- Retirement checks placement, maintenance and Agent binding preconditions.
- Asset lifecycle state is independent of Rack placement and Agent binding; placement comes from Asset Location, and binding is owned by Agent Management.
- Each material change records actor, source, and time through the existing Audit mechanism.
- No module reads or writes another module’s persistence directly.

**Domain ownership**

- Asset & Topology owns Asset identity/lifecycle, topology, placement, and QR mappings.
- Maintenance owns Maintenance Activities and requests Asset state changes through the Asset & Topology contract.
- Ticket Management owns Ticket assignment and exposes the current-assignee check used for manual maintenance fallback.
- Agent Management owns Agent identity/binding and exposes Node eligibility and unbound checks through public contracts.

Existing domain work is tracked in [#29](https://github.com/AR-IMMS/core-backend/issues/29), [#30](https://github.com/AR-IMMS/core-backend/issues/30), [#31](https://github.com/AR-IMMS/core-backend/issues/31), [#32](https://github.com/AR-IMMS/core-backend/issues/32), and [#33](https://github.com/AR-IMMS/core-backend/issues/33). Reuse that work; these Flow 1 tickets complete the remaining application, persistence, API, Dashboard, and AR paths and cover any acceptance gaps.

**Out of scope**

Agent enrollment and credential lifecycle, Workload/Service inventory, telemetry/health logic, and AR spatial anchoring.

### AT-00: Align Flow 1 specification with approved decisions

**Published:** [#35](https://github.com/AR-IMMS/core-backend/issues/35)

**Suggested labels:** `type:docs`

**Goal**

Make the business flow, functional requirements, and implementation tickets consistent before implementation proceeds.

**Acceptance Criteria**

- [x] Asset states are documented as `ACTIVE`, `MAINTENANCE`, and terminal `RETIRED`; `ACTIVE` does not mean healthy or Agent-online.
- [x] Placement and Agent binding are documented as separate from Asset state.
- [x] Asset lifecycle is `ACTIVE`, `MAINTENANCE`, or terminal `RETIRED`; `ACTIVE` does not imply placement or Agent binding. Placement is derived from the active Asset Location and Agent binding is owned by Agent Management.
- [x] Maintenance Activity entering `EXECUTE` sets the Asset to `MAINTENANCE`; `RESUME` or `ABORT` returns it to `ACTIVE` when no other Activity is executing for that Asset.
- [x] A generic Ticket `OPEN` or `CLOSED` transition alone does not change Asset state.
- [x] IT Admin is the default actor for manual maintenance-state changes; the current Ticket assignee can change maintenance state only for an Asset linked to that Ticket.
- [x] A Room size/grid update is rejected if it invalidates any existing Rack placement.
- [x] Rack coordinates use the agreed lower-left anchor of the unrotated footprint.
- [x] Asset retirement requires maintenance to have ended, the Asset to be unmapped, and its Agent binding to be removed.
- [x] Cross-domain ownership and the contract prerequisites for Maintenance, Ticket Management, and Agent Management are documented; unresolved contract issue tracking is handled by AT-13.
- [x] The Asset/Agent interaction direction is documented so the two-way business dependency does not create a direct module call cycle; the selected Flow-level coordinator preserves each domain's ownership.
- [x] Conflicting or superseded statements are removed from the Flow 1 documentation.

**Blocked by:** None.

## AT-12: Define and evolve Asset & Topology consumer contracts

**Published:** [#36](https://github.com/AR-IMMS/core-backend/issues/36)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal:** Define the minimum public Asset & Topology contracts after Flow 1 scope is aligned and make them available before Dashboard and other modules integrate.

**Acceptance criteria**

- [x] After AT-00 and before consumer integration, publish contracts for canonical Asset/Rack IDs and the minimum confirmed topology/placement queries needed by Dashboard and authorized domains.
- [x] Contract types expose neither domain internals nor persistence models; modules consume them without direct collection access.
- [ ] Contracts are refined alongside the implementation tickets, with compatibility and focused contract tests.
- [ ] Material-change audit attribution is implemented by the tickets that perform each change and verified end to end in AT-11.

**Blocked by:** AT-00.

### AT-13: Coordinate cross-domain contracts and Asset-Agent interaction

**Published:** [#37](https://github.com/AR-IMMS/core-backend/issues/37)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Track the external contracts required by Flow 1 and agree an acyclic interaction pattern before implementing cross-domain integrations.

**Acceptance Criteria**

- [x] Maintenance owns Activity state and requests Asset state changes through the Asset & Topology contract; Ticket Management owns assignment and exposes the current-assignee check needed by the manual fallback.
- [x] Agent Management owns Agent identity/binding and exposes both Node eligibility for binding and binding eligibility for retirement through public contracts.
- [x] The Asset/Agent two-way dependency is resolved through an agreed Flow-level coordinator; neither module accesses the other's persistence or directly calls the other in a cycle.
- [ ] Existing owning-domain contract issues are linked, or explicit dependency issues are created/tracked with owners, expected behavior, and unavailable-dependency handling.
- [x] The agreed contract references and interaction direction are recorded in the Flow 1 spec and linked to AT-05/AT-10.

**Progress**

- Documented the approved Flow-level coordinator, `ACTIVE` plus placed binding eligibility, fail-closed retirement binding check, and Maintenance/Ticket Management contract responsibilities in the Flow 1 spec.
- Linked AT-05 (#42) and AT-10 (#47) as consumer implementation issues. No owning-domain contract issues or accountable owners were identified, so this dependency remains tracked in AT-13 until owners are known; separate issues can then be linked or created.
- AT-10 still needs to define and verify concurrent bind/retire protection. AT-05 still needs retry/idempotency and consistency behavior for failed maintenance-state commands.

**Blocked by:** AT-00.

### AT-01: Implement topology management in Asset & Topology

**Published:** [#38](https://github.com/AR-IMMS/core-backend/issues/38)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Persist and expose the location hierarchy required by the Flow 1 UI and other modules.

**Acceptance Criteria**

- [x] The system provisions a default Data Center through the existing seed/bootstrap mechanism. IT Admin can retrieve the default Data Center but cannot create or update Data Centers through Flow 1. IT Admin can create, update, and retrieve Sites and Rooms under that Data Center.
- [x] A Site requires an existing Data Center; a Room requires an existing Site.
- [x] A Room stores positive physical dimensions and grid snap; grid cells are derived and not persisted.
- [x] Invalid dimensions, grid snap, or parent references are rejected without partial writes.
- [x] Public reads expose the topology data needed by the Dashboard and authorized consumers.
- [x] Mutations use repository-standard authorization, validation, error responses, OpenAPI, and Audit behavior.
- [x] Material topology changes record actor, source, and time through the existing Audit mechanism.

**Blocked by:** AT-00 and AT-12.


**Progress:** Implemented and verified locally. The Asset & Topology Jest suite passes (16 suites, 76 tests); TypeScript build check and Nest build pass. The GitHub CLI token was refreshed, but GitHub remained unreachable, so the remote issue checklist/comment could not be updated.

### AT-02: Implement Rack management and Room-map interaction

**Published:** [#40](https://github.com/AR-IMMS/core-backend/issues/40)

**Suggested labels:** `type:feature`, `scope:backend`, `scope:frontend`

**Goal**

Let Admins create, place, move, and inspect Racks using the 2D Room map.

**Acceptance Criteria**

- [x] A Rack belongs to an existing Room, occupies exactly one logical grid cell, and has positive U capacity. Physical width/depth is out of scope.
- [ ] The Dashboard renders the generated Room grid and supports Rack placement preview, rotation, and confirmation. This UI work belongs to the frontend repository.
- [x] Core validates complete-cell grid bounds, supported rotation, and cell occupancy independently of the UI. Remainder strips that do not complete a grid cell are excluded.
- [x] Invalid placement or move leaves the prior Rack layout unchanged. Moving or rotating to the current Room, cell, and rotation is a no-op with no history or Audit Fact.
- [x] Moving a Rack within or between Rooms retains queryable location history; creation with initial placement and real moves are atomic.
- [x] Row and position labels remain independent of map coordinates. AT-02 permits updating U capacity, row label, and position-in-row; Rack ID is immutable.
- [x] Room grid-snap changes are rejected while any Rack is placed. Room dimension changes that put a Rack outside the resulting complete-cell grid are rejected.
- [ ] Rack QR editing is provided through the QR workflow in AT-07.
- [x] Rack layout and location changes record actor, source, and time through the existing Audit mechanism.
- [x] Rack and Room-map queries use a dedicated read-only port; the existing Asset query remains independently available.

**Blocked by:** AT-01 and AT-12.

**Progress**

- Implemented and committed as `54a12e7 feat(asset-topology): manage Racks on Room map` (design/spec updates: `35d2c8b docs: define AT-02 rack management design`).
- Added Rack create/update/move and query APIs, one-cell Room-map placement, complete-cell grid validation, atomic placement and history persistence, Rack location history queries, Room-change guards, Audit attribution, and a dedicated Rack query port independent of the Asset query.
- Rack QR workflow remains in AT-07. Dashboard UI remains frontend work.
- GitHub issue #40 could not be updated automatically: the GitHub connector returned HTTP 403 (`Resource not accessible by integration`) for both issue update and comment. `gh auth refresh -s project` was retried and Enter was pressed at the prompt, but the CLI reported `error connecting to github.com`.

**Verification logs**

```text
> .\node_modules\.bin\tsc.cmd -p tsconfig.build.json --noEmit
(exit code 0)

> .\node_modules\.bin\jest.cmd src/modules/asset-topology --runInBand
Test Suites: 29 passed, 29 total
Tests:       116 passed, 116 total
Snapshots:   0 total

> .\node_modules\.bin\eslint.cmd src/modules/asset-topology/**/*.ts src/modules/asset-topology/*.ts
(exit code 0; no output)

> .\node_modules\.bin\nest.cmd build
(exit code 0; no output)

> .\node_modules\.bin\prettier.cmd --check 'src/modules/asset-topology/**/*.ts' 'src/modules/asset-topology/*.ts' api/v1/asset-topology.yaml
All matched files use Prettier
```

**Ready-to-copy GitHub comment**

````markdown
AT-02 is implemented and committed as `54a12e7 feat(asset-topology): manage Racks on Room map` (design/spec updates: `35d2c8b docs: define AT-02 rack management design`).

Implemented the backend Rack slice: one-cell placement on complete Room grid cells, Rack create/update/move and query APIs, atomic Rack creation and real moves with queryable location history, Room-change guards, Audit attribution, and a dedicated Rack read-only query port independent of the existing Asset query. Rack QR remains for AT-07; Dashboard UI remains frontend work.

Verification logs:
```text
> .\node_modules\.bin\tsc.cmd -p tsconfig.build.json --noEmit
(exit code 0)

> .\node_modules\.bin\jest.cmd src/modules/asset-topology --runInBand
Test Suites: 29 passed, 29 total
Tests:       116 passed, 116 total
Snapshots:   0 total

> .\node_modules\.bin\eslint.cmd src/modules/asset-topology/**/*.ts src/modules/asset-topology/*.ts
(exit code 0; no output)

> .\node_modules\.bin\nest.cmd build
(exit code 0; no output)

> .\node_modules\.bin\prettier.cmd --check 'src/modules/asset-topology/**/*.ts' 'src/modules/asset-topology/*.ts' api/v1/asset-topology.yaml
All matched files use Prettier
```
```
````

### AT-03: Implement Asset registry and initial Node classification

**Published:** [#39](https://github.com/AR-IMMS/core-backend/issues/39)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Allow Admins to register and maintain stable Node records, including before model or serial details are available.

**Acceptance Criteria**

- [x] IT Admin can register an Asset with a required name and Type; Model and manufacturer serial number are optional.
- [x] New Assets receive a stable AR-IMMS ID and start in `ACTIVE`.
- [x] A newly created Asset has no active placement and is shown as unassigned; `ACTIVE` is independent of this placement state.
- [x] A supplied Model must exist and match the Asset Type.
- [x] A fresh environment has the Node Type needed to create the first Node.
- [x] Updating descriptive data does not change Asset identity.
- [x] Public reads expose the canonical Asset reference needed by the Dashboard and Agent Management.
- [x] Focused tests cover registration, classification, identity stability, authorization, persistence, and API behavior.
- [x] Material Asset changes record actor, source, and time through the existing Audit mechanism.

**Progress:** Implemented and verified. The Asset Audit Outbox integration run confirms actor, producer/source, and occurrence time persist through the existing Audit consumer. The test also verifies per-Asset ordered delivery and transaction rollback.

**Blocked by:** AT-00 and AT-12.

**Notes**

- Do not add catalog CRUD, Asset Tag, broad custom attributes, or virtual/workload assets in this ticket.

### AT-04: Implement Asset placement and placement history

**Published:** [#41](https://github.com/AR-IMMS/core-backend/issues/41)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Let Admins assign, move, and unmap an Asset while maintaining correct Rack U occupancy and history.

**Acceptance Criteria**

- [x] An Asset may be unassigned or placed in exactly one Rack U in v1.
- [x] Assignment validates lifecycle eligibility (`ACTIVE` or `MAINTENANCE`; reject terminal `RETIRED`), Rack existence, U capacity, and availability.
- [x] Two Assets cannot occupy the same U; one Asset cannot have multiple active placements.
- [x] Concurrent operations cannot commit conflicting placements; partial unique indexes protect active Asset and Rack-U assignments.
- [x] A move validates the destination before closing the old placement; failure preserves the previous placement. Repeating the current Rack-U placement is a no-op without history or Audit Fact.
- [x] Unmap releases the U and retains the Asset and prior placement history; it does not unlink an Agent or retire the Asset. Maintenance state does not prevent placement changes.
- [x] Current and historical placement can be queried through the Asset query boundary.
- [x] Tests cover assignment, move, unmap, collisions, concurrency and history; the Mongo integration harness covers concurrent operations.
- [x] Placement changes record actor, source, and time through the existing Audit mechanism.

**Blocked by:** AT-02, AT-03, and AT-12.

**Progress**

- Implemented and committed as `9bad36e feat(asset-topology): manage Asset placement and history`.
- Added place/move/unmap operations, current and historical placement queries, Audit Facts, Mongo Asset Location persistence, and active-Asset / active-Rack-U unique indexes. Asset lifecycle remains separate from placement; `ACTIVE` and `MAINTENANCE` are eligible, while `RETIRED` is rejected.
- Updated the module spec and Flow 1 business flow to record the approved eligibility rule and query/history behavior.
- Recorded the Flow 1 business-flow clarification in the shared-docs submodule commit `e4365ac`; the parent repository pointer was left unchanged because it already had an unadvanced AT-02 submodule commit.
- The Mongo concurrency integration harness is present but could not run in this environment because `MONGODB_TEST_URI` is unset, localhost MongoDB is unreachable, and Docker access is denied.
- GitHub issue #41 could not be updated through the connector: the issue update returned HTTP 403 (`Resource not accessible by integration`). This local checklist and ready-to-copy comment are available for manual update.

**Verification logs**

```text
> .\node_modules\.bin\jest.cmd src/modules/asset-topology --runInBand
Test Suites: 33 passed, 33 total
Tests:       135 passed, 135 total
Snapshots:   0 total

> .\node_modules\.bin\tsc.cmd -p tsconfig.build.json --noEmit
(exit code 0)

> .\node_modules\.bin\eslint.cmd 'src/modules/asset-topology/**/*.ts' 'src/modules/asset-topology/*.ts' 'test/asset-topology-placements.integration.ts'
(exit code 0; no output)

> .\node_modules\.bin\prettier.cmd --check 'src/modules/asset-topology/**/*.ts' 'src/modules/asset-topology/*.ts' 'test/asset-topology-placements.integration.ts' api/v1/asset-topology.yaml
All matched files use Prettier code style!

> .\node_modules\.bin\nest.cmd build
(exit code 0)

> node -r ts-node/register -r tsconfig-paths/register test/asset-topology-placements.integration.ts
Error: MONGODB_TEST_URI must be set for MongoDB test suites
```

**Ready-to-copy GitHub comment**

````markdown
AT-04 Asset placement is implemented. Place/move/unmap operations write Asset Location history and Audit Facts through the existing Outbox. Mongo partial unique indexes enforce one active placement per Asset and one occupant per Rack U. Current placement appears in Asset reads; historical intervals are queryable through the Asset query boundary.

Eligibility follows the approved clarification: `ACTIVE` and `MAINTENANCE` Assets may be placed, moved, or unmapped; terminal `RETIRED` Assets are rejected. Placement changes do not alter lifecycle or Agent binding.

Verification logs:
```text
> .\node_modules\.bin\jest.cmd src/modules/asset-topology --runInBand
Test Suites: 33 passed, 33 total
Tests:       135 passed, 135 total
Snapshots:   0 total

> .\node_modules\.bin\tsc.cmd -p tsconfig.build.json --noEmit
(exit code 0)

> .\node_modules\.bin\eslint.cmd 'src/modules/asset-topology/**/*.ts' 'src/modules/asset-topology/*.ts' 'test/asset-topology-placements.integration.ts'
(exit code 0; no output)

> .\node_modules\.bin\prettier.cmd --check 'src/modules/asset-topology/**/*.ts' 'src/modules/asset-topology/*.ts' 'test/asset-topology-placements.integration.ts' api/v1/asset-topology.yaml
All matched files use Prettier code style!

> .\node_modules\.bin\nest.cmd build
(exit code 0)

> node -r ts-node/register -r tsconfig-paths/register test/asset-topology-placements.integration.ts
Error: MONGODB_TEST_URI must be set for MongoDB test suites
```

The placement integration harness, including concurrent Rack-U and per-Asset assignment attempts, is added but could not run because this environment has no `MONGODB_TEST_URI`, localhost MongoDB is unreachable, and Docker access is denied.
````

### AT-05: Implement Asset state and maintenance coordination

**Published:** [#42](https://github.com/AR-IMMS/core-backend/issues/42)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Keep Asset state authoritative in Asset & Topology while allowing Maintenance Activity and authorized users to change the maintenance state.

**Acceptance Criteria**

- [x] Supported Asset states are `ACTIVE`, `MAINTENANCE`, and terminal `RETIRED`.
- [x] Valid maintenance transitions are `ACTIVE → MAINTENANCE` and `MAINTENANCE → ACTIVE`.
- [ ] The Maintenance module can request the state change through an explicit public Asset & Topology contract when an Activity enters `EXECUTE`, `RESUME`, or `ABORT`.
- [ ] The Asset remains `MAINTENANCE` while any linked Maintenance Activity is executing.
- [ ] A generic Ticket status change does not trigger an Asset state transition.
- [ ] IT Admin can use the manual fallback; the current assignee can change maintenance state only for an Asset linked to their currently assigned Ticket.
- [ ] Authorization is checked at the time of the change; a previous assignee loses access after reassignment.
- [ ] Manual action cannot return an Asset to `ACTIVE` while an Activity for it is still executing.
- [x] Asset state changes record actor/source and time through the existing Audit mechanism.
- [ ] Contract tests verify Maintenance, Ticket authorization, and Asset state interactions without cross-module persistence access.

**Progress**

- Added immutable Asset transitions between `ACTIVE` and `MAINTENANCE`; requests against `RETIRED` Assets are rejected and repeated target states are no-ops.
- Exposed `ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT`; state persistence and the actor/source Audit Fact share the existing unit of work. Retries after a failed command can safely repeat the target state.
- Updated the spec and Flow 1 wording with atomic Audit behavior and the retry rule.
- Maintenance Activity coordination, current Ticket-assignee authorization, and their contract tests remain with the owning modules; those modules and contracts are not present in this checkout.

**GitHub comment draft — not posted (authentication/network unavailable)**

Implemented the Asset-owned maintenance-state transitions and exported `ASSET_TOPOLOGY_MAINTENANCE_COMMANDS_PORT`. State persistence and actor/source Audit attribution use the existing unit of work; repeated requests for the stored state are no-ops. Updated the Asset & Topology spec and Flow 1 business document with the retry behavior.

Verification evidence:

- `jest --runInBand src/modules/asset-topology`: `Test Suites: 34 passed, 34 total`; `Tests: 141 passed, 141 total`.
- `tsc -p tsconfig.build.json --noEmit`: exit code 0; no diagnostics.
- `nest build`: exit code 0; no diagnostics.
- Scoped ESLint: exit code 0; no diagnostics.
- Scoped Prettier check: `All matched files use Prettier code style!`.

Maintenance Activity coordination, current Ticket-assignee authorization, manual fallback integration, and cross-module contract tests remain pending the owning modules/contracts.

GitHub authentication was attempted with `gh auth refresh -s project` in PowerShell and cmd.exe, followed by `gh auth login -h github.com` in cmd.exe. Each failed with `error connecting to github.com`. The GitHub connector can read issue #42, but its checklist update and comment write both returned HTTP 403 `Resource not accessible by integration`; the remote issue remains unchanged.

**Blocked by:** AT-03, AT-12, and AT-13.

### AT-06: Implement the Asset and placement Dashboard workflow

**Published:** [#43](https://github.com/AR-IMMS/core-backend/issues/43)

**Suggested labels:** `type:feature`, `scope:frontend`

**Goal**

Complete the Admin’s Node provisioning and Rack placement workflow in the Web Dashboard.

**Acceptance Criteria**

- [ ] Admin can register a Node and see it as unassigned.
- [ ] Admin can choose a Node, Rack, and U position and assign it through the Asset & Topology API.
- [ ] The Rack view distinguishes free and occupied U positions based on confirmed placements.
- [ ] Admin can move or unmap a Node and view its current and historical placement.
- [ ] UI validation gives prompt feedback; Core remains authoritative for placement conflicts.
- [ ] Errors identify the rejected action and relevant constraint without implying the change succeeded.

**Blocked by:** AT-02, AT-03, AT-04, and AT-12.

### AT-07: Implement Rack and Node QR mapping and resolution

**Published:** [#44](https://github.com/AR-IMMS/core-backend/issues/44)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Give both Racks and Nodes unique QR identities that resolve to canonical Asset & Topology records.

**Acceptance Criteria**

- [x] A Node receives an active QR mapping when created.
- [x] Admin can assign, replace, or deactivate Rack and Node QR mappings.
- [x] Each target has at most one active QR; each active QR identifies at most one Rack or Node.
- [x] Active uniqueness is enforced by persistence, including concurrent updates.
- [x] Resolving an active QR returns target type, canonical ID, and the information needed by the Dashboard/AR client.
- [x] Inactive historical QR mappings are retained but not resolved as active.
- [x] Tests cover generation, collision, replacement, deactivation, resolution, and history.
- [x] QR mapping changes record actor, source, and time through the existing Audit mechanism.

**Blocked by:** AT-02, AT-03, and AT-12.

### AT-08: Implement label preview and export

**Published:** [#45](https://github.com/AR-IMMS/core-backend/issues/45)

**Suggested labels:** `type:feature`, `scope:backend`, `scope:frontend`

**Goal**

Let Admins produce single or bulk printable Rack and Node QR labels.

**Acceptance Criteria**

- [x] Admin can request single or bulk labels in PDF and SVG through the backend export API.
- [x] Rack labels include QR and readable Rack identity/location.
- [x] Node labels include QR, Node name, and current placement; unassigned Nodes are clearly represented as unassigned.
- [x] IP is omitted until its authoritative source and freshness are defined.
- [ ] Dashboard provides a print preview and download for generated labels.
- [x] Backend tests verify label content and valid PDF/SVG output.

**Progress**

- Backend implementation is complete: IT Admins can export selected Rack/Node labels in PDF or SVG, for 1–100 IDs per request. Labels use current Asset/Rack query results and active QR mappings. Dashboard preview/download is skipped in this backend repository and remains for the frontend repository.

**Verification logs**

- `pnpm exec jest src/modules/asset-topology/application/labels/__tests__/export-asset-labels.use-case.spec.ts src/modules/asset-topology/infrastructure/labels/__tests__/label-document.renderer.spec.ts src/modules/asset-topology/presentation/labels/__tests__/label-export.controller.spec.ts --runInBand` — `Test Suites: 3 passed, 3 total`; `Tests: 11 passed, 11 total`; `exit code: 0`.
- `pnpm exec jest src/modules/asset-topology --runInBand` — `Test Suites: 39 passed, 39 total`; `Tests: 160 passed, 160 total`; `exit code: 0`.
- `pnpm check:all` — ran `tsc --noEmit -p tsconfig.spec.json && eslint "{src,apps,libs,test}/**/*.ts"`; `exit code: 0`.
- `pnpm exec prettier --check api/v1/asset-topology.yaml` — `All matched files use Prettier code style!`; `exit code: 0`.

**Blocked by:** AT-04, AT-06, AT-07, and AT-12.

### AT-09: Integrate QR scanning into the AR client

**Published:** [#46](https://github.com/AR-IMMS/core-backend/issues/46)

**Suggested labels:** `type:feature`, `scope:frontend`

**Goal**

Allow the AR client to scan either a Rack or Node QR and resolve it to the correct Flow 1 record.

**Acceptance Criteria**

- [ ] Scanning a Rack QR resolves to that Rack; scanning a Node QR resolves to that Node.
- [ ] The client displays identity and confirmed placement returned by the public Asset & Topology contract.
- [ ] Unknown and inactive QR values produce a clear unresolved result.
- [ ] The client does not treat a QR as an Agent ID or spatial anchor.
- [ ] Integration tests cover Rack, placed Node, unassigned Node, and invalid/inactive QR cases.

**Blocked by:** AT-07 and AT-12.

**Progress:** Skipped in this backend repository as requested. Issue #46 is labeled `scope:frontend`; the AR client scanning UI and its integration tests belong to the frontend repository. No AT-09 implementation or tests were run here.

### AT-10: Implement retirement and Agent Management integration

**Published:** [#47](https://github.com/AR-IMMS/core-backend/issues/47)

**Suggested labels:** `type:feature`, `scope:backend`

**Goal**

Retire eligible Assets and Racks while preserving identity/history and respecting Agent Management ownership.

**Acceptance Criteria**

- [ ] An Asset can be retired only from `ACTIVE`; it must first leave `MAINTENANCE`.
- [ ] An Asset must be unmapped before retirement.
- [ ] Node retirement checks binding through Agent Management’s public contract; Asset & Topology never reads Agent persistence directly.
- [ ] If binding status cannot be verified, retirement is rejected with an actionable error.
- [ ] A Rack cannot be retired while any Asset remains placed in it.
- [ ] Successful retirement is terminal and preserves identifiers, references, placement/QR history, and Audit attribution.
- [ ] Rejected retirement leaves state and history unchanged.
- [ ] Tests cover active binding, no binding, unavailable Agent Management, maintenance state, current placement, and Rack occupancy.

**Blocked by:** AT-03, AT-04, AT-05, AT-12, and AT-13.

**Progress:** Paused by user decision until AT-13 (#37) resolves the Asset–Agent public-contract approach. AT-10 requires Agent Management binding status, and the approved spec keeps the interaction pattern unresolved without a coordinator/event design. No AT-10 implementation or tests were run.

### AT-11: Verify Flow 1 end to end

**Published:** [#48](https://github.com/AR-IMMS/core-backend/issues/48)

**Suggested labels:** `type:test`, `scope:backend`, `scope:frontend`

**Goal**: Demonstrate the complete Flow 1 behavior across backend, Dashboard, AR QR resolution, Audit, and required module boundaries.

**Acceptance Criteria**

- [ ] An Admin can create topology, configure a Room map, and place a Rack.
- [ ] An Admin can register a Node, print its label, place it in a U, move it, and unmap it while preserving history.
- [ ] Rack and Node labels resolve to the correct records through the AR client.
- [ ] Maintenance state changes through Activity and authorized manual fallback behave as specified.
- [ ] Retirement is blocked or allowed according to placement, maintenance, and Agent binding conditions.
- [ ] Material changes are attributable through the existing Audit mechanism.
- [ ] No step depends on direct cross-module database access.

**Blocked by:** AT-01 through AT-10, AT-12, and AT-13.

**Progress:** Backend integration coverage was run for topology Audit delivery/rollback, Asset registration/QR/Audit, and Asset placement/move/unmap history. AT-11 remains incomplete: AT-10 is waiting on AT-13, the Rack/Room-map-to-placement workflow is not exercised as one end-to-end scenario, and AR/Dashboard acceptance belongs to the frontend repository.

**Verification logs**

- `MONGODB_TEST_URI=mongodb://localhost:27017/ar_imms_core_test?replicaSet=rs0 pnpm run asset-topology:integration` — `PASS topology write and Audit Outbox transaction rollback`; `PASS Site and Room Audit delivery through the Audit consumer`; `exit code: 0`.
- `MONGODB_TEST_URI=mongodb://localhost:27017/ar_imms_core_test?replicaSet=rs0 pnpm run asset-topology:assets:integration` — `PASS Asset registration/update Audit delivery and transaction rollback`; `exit code: 0`.
- `MONGODB_TEST_URI=mongodb://localhost:27017/ar_imms_core_test?replicaSet=rs0 pnpm run asset-topology:placements:integration` — `PASS Asset placement atomicity, concurrent Rack-U uniqueness, move/unmap history, and Audit Outbox rollback`; `exit code: 0`.
- `pnpm exec jest src/modules/asset-topology --runInBand` — `Test Suites: 39 passed, 39 total`; `Tests: 160 passed, 160 total`; `exit code: 0`.
- `pnpm check:all` — `tsc --noEmit -p tsconfig.spec.json && eslint "{src,apps,libs,test}/**/*.ts"`; `exit code: 0`.
