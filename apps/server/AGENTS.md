# AGENTS.md — Server

## Scope

Applies to all code under `apps/server`.

The server is authoritative.

It owns:

- authentication,
- order validation,
- turn resolution,
- world state,
- delta generation,
- replay synchronization,
- province ownership,
- population,
- buildings,
- deposits,
- economy,
- admin APIs.

## Hard rules

- Never trust the client.
- Never accept gameplay mutations without validation.
- Never broadcast private information to unauthorized countries.
- Keep turn resolution deterministic.
- Keep WebSocket state synchronization correct before optimizing it.
- Preserve province ID stability.

## Validation

All external input must be validated.

Sources:

- REST requests
- WebSocket messages
- uploaded files
- admin actions
- imported content

Use Zod or explicit guards.

## World state

The server owns `WorldBase`.

Rules:

- Keep state normalized.
- Prefer indexed records over nested scans.
- Avoid full world clones.
- Track dirty sections.
- Add new systems as explicit world sections.

Every new world section must define:

- initialization
- ownership
- persistence
- delta behavior
- replay behavior
- admin visibility

## Turn resolution

Requirements:

- deterministic
- reproducible
- phase-based
- multiplayer-safe

Never:

- depend on request timing
- depend on socket order
- use hidden randomness

Prefer:

- explicit phases
- indexed processing
- pure helper functions

## Delta system

Changes to world state must be reflected in:

- WORLD_DELTA mask
- delta serialization
- replay logic
- snapshot logic
- client application logic

Do not change compact keys casually.

## Performance

Hot paths:

- turn resolve
- world delta generation
- replay generation
- province processing
- population processing

Avoid:

- repeated full scans
- JSON stringify equality checks
- deep cloning large structures

Prefer:

- indexes
- dirty tracking
- partial snapshots

## Security

- JWT secrets must not be hardcoded for production.
- Uploaded files must be validated.
- Path traversal must be impossible.
- Admin endpoints must stay protected.
- Never expose internal filesystem paths.

## Database

- Keep Prisma schema clean.
- Use stable identifiers.
- Avoid destructive migrations.
- Keep development migrations reversible where practical.

## Do not break

- AUTH/AUTH_OK
- ORDER_BROADCAST
- WORLD_DELTA
- replay synchronization
- snapshot fallback
- admin tools
- province ownership
- building extraction
- population generation
- MVT tile serving
