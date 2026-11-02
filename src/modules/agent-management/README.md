# Agent Management

Agent Management owns Agent registration, installation identity, Node bindings,
and credential lifecycle. Asset & Topology remains the owner of Node state; this
module checks eligibility through its public contract.

## Implemented capabilities

- `application/registration/` issues bootstrap tokens, enrolls installations,
  and recovers matching enrollment attempts.
- `application/access-lifecycle/` resolves active Agent credentials and revokes
  bindings. Matching HTTP adapters live in `presentation/`.

MongoDB and cryptographic adapters remain under `infrastructure/`. Business
outcome errors are framework-free under `domain/errors/`; operational failures
remain with their application capability.

## Future Flow 2 capabilities

Agent Registry management visibility and Agent Control APIs are not implemented
yet. Add their capability folders when the corresponding business use cases and
contracts are approved; do not use these capabilities to imply that those APIs
already exist. No Control Plane, heartbeat, telemetry ingestion, Collector
activation, or uninstall endpoint is provided by the current implementation.
