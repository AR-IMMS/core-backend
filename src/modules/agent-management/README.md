# Agent Management

## 🚀 Quickstart (30-second Onboarding)

Run the Core API with `pnpm start:dev`, then use the invitation and synchronization routes in [`api/v1/agent-enrollment.yaml`](../../../api/v1/agent-enrollment.yaml). The module is composed by `AgentManagementModule`; it is not started independently.

## 🗺️ Architecture Overview

Application use cases are grouped by enrollment, binding, and lifecycle responsibilities. Fleet HTTP contracts are ports under `application/ports/fleet`; Core owns business eligibility, its binding projection, and invitation orchestration state.

## ⚡ Cheat Sheet

| Common Task | Service/Port to Inject | Method/Usage |
| --- | --- | --- |
| Request a Fleet invitation | `RequestFleetInvitationUseCase` | `execute()` checks eligibility, local and Fleet binding state, and requests an idempotent invitation. |
| Synchronize Fleet enrollment | `SynchronizeFleetEnrollmentUseCase` | `execute()` rechecks eligibility and persists operation and association state. |
| Coordinate Node lifecycle gates | `CoordinateNodeLifecycleUseCase` | Implements the exported `AgentNodeLifecycleCoordination` contract using Fleet's gate port. |
| Read business eligibility | `NodeEligibilityPort` | `getEligibility(nodeId)` delegates to Asset & Topology's public query. |
| Read/write Core binding projection | `BindingProjectionPort` | `hasActiveForNode()` and `upsert()` manage the minimal business association. |
| Read/write Core invitation operation | `EnrollmentOperationPort` | Stores idempotency, invitation, synchronization, and completion status. |

## ⚙️ Configuration Reference

Values are read by `FleetManagerAdapterModule` and validated by `src/platform/config/env.schema.ts`.

| Property | Type | Default | Required | Description |
| --- | --- | --- | --- | --- |
| `FLEET_MANAGER_BASE_URL` | HTTPS URL | unset | No | When set, enables Fleet HTTP adapters; when unset, disabled ports are provided. |
| `FLEET_CLIENT_CERTIFICATE` / `FLEET_CLIENT_CERTIFICATE_FILE` | PEM string / file path | none | With Fleet URL | Client certificate, supplied inline or by file. |
| `FLEET_CLIENT_KEY` / `FLEET_CLIENT_KEY_FILE` | PEM string / file path | none | With Fleet URL | Client private key, supplied inline or by file. |
| `FLEET_CA_CERTIFICATE` / `FLEET_CA_CERTIFICATE_FILE` | PEM string / file path | optional | No | Optional CA certificate, inline or by file. |
| `FLEET_REQUEST_TIMEOUT_MS` | positive integer | `3000` | No | Fleet HTTP request timeout. |
| `FLEET_MAX_RETRIES` | integer, 0–5 | `2` | No | Maximum retry count. |
| `FLEET_MAX_RETRY_DELAY_MS` | positive integer, max 5000 | `1000` | No | Maximum delay between retries. |

## ⚠️ Gotchas & Pitfalls

- Asset & Topology owns Asset/Node state and eligibility. Agent Management consumes its public contract and exports only binding queries and Node lifecycle coordination.
- Core's Mongo stores contain invitation orchestration state and a minimal association projection. Fleet remains authoritative for technical installation identity, credentials, enrollment, authorization, and runtime state.
- Enrollment invitation and synchronization routes require a human principal with `agent:manage`. Their request/response contracts are in the OpenAPI source above.
- Historical migration entries for removed legacy collections remain ordered and registered; they do not indicate active Core-owned Agent stores.

## Module layout

```text
application/
├── enrollment/  # Invitation request, synchronization, operation port, application errors
├── binding/     # Core business binding projection port
├── lifecycle/   # Fleet Node gate coordination use case
└── ports/       # Core eligibility port and Fleet external contracts
```

There are no Agent Management domain entities, value objects, or domain policies. See [As-Is architecture diagrams](../../../docs/local/architecture/agent-management/as-is/README.md) for full composition and source references.
