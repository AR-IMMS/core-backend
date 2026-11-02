# Agent Management

Agent Management owns Agent registration, installation identity, Node bindings,
and credential lifecycle. Asset & Topology remains the owner of Node state; this
module checks eligibility through its public contract.

## Implemented capabilities

- `application/registration/` issues bootstrap tokens, enrolls installations,
  and recovers matching enrollment attempts.
- `application/access-lifecycle/` resolves active Agent credentials and revokes
  bindings. Matching HTTP adapters live in `presentation/`.
- `application/agent-registry/` provides read-only installation and binding
  history queries for authorized Admins; `presentation/agent-registry/` exposes
  the cursor-paginated HTTP APIs. Registry responses omit arbitrary enrollment
  metadata and all credential, token, and recovery material.

MongoDB and cryptographic adapters remain under `infrastructure/`. Business
outcome errors are framework-free under `domain/errors/`; operational failures
remain with their application capability.

## Not implemented

Agent Control APIs are not implemented. No Control Plane, heartbeat, telemetry
ingestion, Collector activation, or uninstall endpoint is provided by the current
implementation. A registered installation or active binding does not indicate
Agent connectivity or telemetry health.
