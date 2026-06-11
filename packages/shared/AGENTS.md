# AGENTS.md — Shared Protocol

## Scope

Applies to all code under `packages/shared`.

This package is the protocol contract between client and server.

## Critical rule

Changes here affect the entire project.

Any modification may require updates to:

- client
- server
- replay system
- world delta generation
- admin tooling
- save/persistence code

## Shared type rules

- Prefer explicit domain types.
- Avoid `any`.
- Avoid ambiguous payloads.
- Keep identifiers stable.
- Keep message names explicit.

## Protocol rules

WebSocket message contracts must remain synchronized.

When modifying:

- WsInMessage
- WsOutMessage
- WorldBase
- WorldDelta
- Order
- OrderType

verify all consumers.

## Delta rules

If a world section is added:

- update WORLD_DELTA_MASK
- update compact payload keys
- update snapshot bootstrap
- update replay handling
- update client application logic

## Order rules

Adding a new order type requires:

- shared type update
- server validation
- server resolution
- client UI support
- rejection handling

## Naming

Use domain names:

- provinceId
- countryId
- turnId
- worldStateVersion
- buildingId
- goodId

Avoid generic names.

## Do not break

- AUTH protocol
- WORLD_DELTA structure
- replay semantics
- existing compact keys
- existing identifiers
