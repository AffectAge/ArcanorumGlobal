# AGENTS.md

## Project identity

ArcanorumGlobal is a browser-based grand strategy / WEGO strategy game monorepo.

The current implementation uses:

- Client: Vite + React + TypeScript.
- UI stack: Tailwind CSS, Zustand, MapLibre GL, Framer Motion, Lucide React, Headless UI, Radix UI, Floating UI, Sonner, Cmdk, React Hook Form, Zod, Colord, Apache ECharts.
- Server: Node.js, Express, WebSocket, TypeScript, JWT auth, SQLite + Prisma.
- Optional infrastructure: Redis for presence, rate limiting, pub/sub, and planning/cache features.
- Shared package: `@arcanorum/shared` for cross-client/server protocol and world model types.

This file defines mandatory rules for AI agents and contributors working in this repository.

## Core development principles

1. Keep the server authoritative.
   - The client may display previews and optimistic overlays.
   - The server validates orders, resolves turns, mutates world state, and emits official deltas.
   - Never trust client-side state for final game rules.

2. Preserve deterministic WEGO resolution.
   - Player actions are orders.
   - Orders are validated, queued, and resolved by the server.
   - Turn resolution must be deterministic for the same world state and same ordered input.
   - Avoid hidden randomness. When randomness is needed, use explicit seeded RNG and store the seed/context.

3. Treat `packages/shared` as the protocol contract.
   - Any change to shared types must be reflected in both client and server.
   - Do not add server-only or client-only assumptions to shared types.
   - Maintain backward-compatible migration paths during active development when practical, but stable save compatibility is not required yet.

4. Prefer incremental systems over big rewrites.
   - Add isolated modules, tests, and migration steps.
   - Do not replace working map, WebSocket, delta-sync, or auth systems unless the replacement is explicitly requested.

5. Optimize hot paths by design.
   - Large world state sections must not be deep-cloned casually.
   - Avoid repeated full scans of province/country maps inside per-turn or per-socket hot paths.
   - Use dirty sets, indexes, partial snapshots, and structural comparisons where possible.

## Repository structure rules

Expected structure:

```text
/apps/client        React UI, map rendering, local UI state, WS client
/apps/server        Authoritative server, REST API, WS server, Prisma, turn resolve, map tiles
/packages/shared    Shared TypeScript types, protocol contracts, world model definitions
/scripts            Root utility scripts
```

Rules:

- Client-only code belongs in `apps/client`.
- Server-only code belongs in `apps/server`.
- Shared protocol, world, order, and delta types belong in `packages/shared`.
- Do not import server files from the client.
- Do not import client files from the server.
- Do not duplicate shared protocol types in client or server.

## Required commands before finishing work

Run these commands when the relevant code is changed:

```bash
npm run typecheck
npm run build
```

For server schema or Prisma changes:

```bash
npm run prisma:generate -w @arcanorum/server
npm run prisma:push -w @arcanorum/server
npm run typecheck -w @arcanorum/server
```

For client-only changes:

```bash
npm run typecheck -w @arcanorum/client
npm run build -w @arcanorum/client
```

For server-only changes:

```bash
npm run typecheck -w @arcanorum/server
npm run build -w @arcanorum/server
```

If a command cannot be run in the current environment, state that explicitly in the final response and explain why.

## TypeScript rules

- Use TypeScript strictly and deliberately.
- Avoid `any`. If unavoidable, isolate it at an external boundary and validate immediately.
- Prefer explicit domain types over loose records.
- Use `unknown` for untrusted input, then validate with Zod or narrow manually.
- Keep exported types stable and documented when they are part of the client/server contract.
- Avoid large files becoming dumping grounds. Split by feature once logic becomes difficult to scan.
- Prefer pure helper functions for game rules and state transforms.
- Avoid side effects inside functions that should only calculate previews, validation results, or diffs.

## Naming conventions

- Use clear domain names: `provinceId`, `countryId`, `turnId`, `worldStateVersion`, `buildingId`, `goodId`.
- Avoid vague names such as `data`, `item`, `obj`, `thing`, except in tiny local scopes.
- Use `ById`, `ByProvince`, `ByCountry`, etc. for indexed records.
- Keep WebSocket message names uppercase and explicit: `WORLD_DELTA`, `ORDER_BROADCAST`, `REQUEST_RESOLVE`.
- Keep order types explicit and finite. Update all validation, UI, and resolve branches when adding one.

## Shared protocol rules

When editing `packages/shared/src/index.ts`:

1. Update client readers/writers.
2. Update server validators and emitters.
3. Update delta mask and compact keys if the world section participates in `WORLD_DELTA`.
4. Update snapshot/bootstrap logic if the new data must exist on login or reconnect.
5. Update any admin endpoints that inspect or mutate the new section.

Do not silently add optional fields that the server never initializes or the client never handles.

## WebSocket and world synchronization rules

The synchronization model is:

- `AUTH` -> `AUTH_OK` with full `worldBase` when needed.
- Client sends `OrderDelta`.
- Server validates and broadcasts `ORDER_BROADCAST`.
- Resolve emits compact `WORLD_DELTA`.
- Client applies delta and sends `WORLD_DELTA_ACK`.
- Client may request `WORLD_DELTA_REPLAY_REQUEST` if it detects a gap.
- Fallback snapshot endpoint exists for soft resync.

Mandatory rules:

- Never broadcast private game data to all sockets.
- Keep `NEWS_EVENT` visibility routing strict.
- Keep private events scoped to the target country and admins only.
- Never send game WS messages to unauthenticated sockets except connection/auth errors.
- Always increment `worldStateVersion` consistently when official world state changes.
- Do not change compact delta keys without updating all consumers.
- Add new world sections to delta masks only when they need incremental sync.

## World state rules

`WorldBase` is the authoritative in-memory world model. It currently includes country resources, province ownership, names, colonization, infrastructure, population, buildings, construction queues, resource deposits, and exploration queues.

Rules:

- Treat province and country maps as sparse indexed records.
- Preserve absent-vs-empty semantics.
- Do not mutate shared references that are still used as previous snapshots.
- Prefer targeted updates over replacing large sections.
- Maintain dirty-section tracking when changing hot-path world sections.
- For new state sections, define:
  - owner/source of truth,
  - initialization path,
  - validation rules,
  - resolve behavior,
  - delta behavior,
  - admin/debug visibility,
  - persistence expectations.

## Order system rules

Current order model:

- `BUILD`
- `BUDGET`
- `ARMY_MOVE`
- `COLONIZE`

Rules:

- Every order must be validated on the server.
- The client may prevalidate for UX, but server validation is final.
- Rejected orders must return a useful reason.
- Order payloads must be narrowed before use.
- Do not execute order payloads directly as arbitrary data.
- Do not let one invalid order break turn resolution for all players.
- If adding an order type, update:
  - shared `OrderType`,
  - server validation,
  - turn resolver,
  - rejected-order handling,
  - client order creation,
  - optimistic overlay if applicable,
  - UI feedback.

## Turn resolution rules

- Resolve turns in explicit phases.
- Keep phase order stable and documented.
- Use pure functions where practical.
- Build indexes before phase loops instead of repeatedly scanning all provinces.
- Record rejected or impossible operations instead of failing silently.
- Avoid network, file system, and database calls inside tight simulation loops unless unavoidable.
- All rule changes must preserve multiplayer fairness.

Recommended phase style:

```text
1. collect/validate orders
2. apply administrative locks and eligibility checks
3. resolve movement/colonization/construction/economy/population
4. produce events and rejected order records
5. build dirty-section WORLD_DELTA
6. broadcast and persist required data
```

## Map and province rules

The map system uses prebuilt MVT tiles and ADM1 GeoJSON data.

Rules:

- Keep MapLibre rendering client-side.
- Keep tile serving and authoritative province metadata server-side.
- Do not send full heavy GeoJSON over WebSocket.
- Use REST/tile endpoints for map geometry.
- Use WebSocket only for gameplay state changes.
- Province IDs must be stable across client, server, DB, and map data.
- Do not use display names as stable identifiers.
- Expensive geometry processing should happen offline or in build scripts, not during request handling.
- Preserve `renderWorldCopies=false` assumptions for Earth map UX unless explicitly changing the map model.

## Population rules

Population is province-scoped and currently stores:

- `populationTotal`
- `culturePct`
- `ideologyPct`
- `religionPct`
- `racePct`
- `professionPct`

Rules:

- Percentage maps must sum to 100 when edited/generated, unless a specific transitional state is documented.
- Birth/death changes should affect totals first.
- Percentage distributions should not drift implicitly unless a mechanic explicitly changes them.
- Admin population tools must validate scope: province, country, or world.
- Large population updates must use delta sections and avoid full `worldBase` replacement.

## Buildings, economy, and resources

Current systems include buildings, construction queues, provincial infrastructure, provincial deposits, building warehouses, extraction, and country resources.

Rules:

- Building definitions should be data-driven when possible.
- Building instances must have stable `instanceId` values.
- Resource extraction must check deposits when `extractionRequiresDeposit` is enabled.
- Extraction must not reduce deposits below zero.
- Warehouse changes must be deterministic and included in the relevant world delta.
- Market/economy logic should keep last-turn diagnostic fields when useful for UI/debugging.
- Do not hide failed production. Store inactive reasons or coverage diagnostics.

## Content upload rules

The server accepts several image upload categories, including flags, crests, markets, resource icons, UI backgrounds, civilopedia images, and content logos.

Rules:

- Keep upload validation server-side.
- Enforce image-only upload restrictions.
- Preserve size and aspect-ratio rules for flags and crests.
- Never trust uploaded filenames.
- Store generated filenames with safe extensions.
- Never allow path traversal through content kind or filename.
- When adding upload categories, update directory creation, URL resolution, cleanup scripts, and admin UI.

## Client architecture rules

- Keep React components focused and composable.
- Keep game state in Zustand stores or clearly scoped hooks.
- Do not put authoritative game rules only in React components.
- Map rendering, overlays, and panels should be separated.
- Use memoized selectors for large world sections.
- Avoid subscribing `MapView` or heavy panels to the entire `worldBase` object.
- Avoid unnecessary rerenders from broad store selectors.
- Use ECharts only for data-heavy charts where it adds value.
- Keep modals and admin panels accessible and keyboard-friendly where practical.

## UI style rules

The target UI direction is modern grand strategy:

- dark graphite / charcoal base,
- high information density,
- readable typography,
- minimal decorative noise,
- clear hierarchy,
- restrained animation,
- industrial/administrative tone,
- no fantasy/RPG styling unless explicitly requested.

Rules:

- Do not use random colors. Use semantic colors and existing theme tokens/classes.
- Avoid excessive glow, blur, and animation.
- Tables and dense admin screens must prioritize readability.
- Buttons must have clear hover/active/disabled states.
- Icons must remain legible at small sizes.
- No hardcoded text in English if the surrounding UI is Russian, unless the project section is already English.

## Server API rules

- Validate request bodies with Zod or explicit guards.
- Return stable error codes where the client needs to branch on errors.
- Keep admin endpoints protected.
- Do not expose private player/country data through public endpoints.
- Keep pagination for large lists.
- Avoid loading large world sections when a scoped query is enough.
- For new endpoints, document purpose, auth requirement, request shape, and response shape.

## Database and Prisma rules

- Keep Prisma schema changes deliberate and minimal.
- Prefer explicit IDs and stable relations.
- Do not use destructive migrations without a clear reason.
- During active development, stable save compatibility is not mandatory, but avoid unnecessary data loss.
- For schema changes, update seed/init code and admin/debug endpoints.
- Do not make the database the only source of transient per-turn state unless the performance impact is understood.

## Redis and optional infrastructure rules

- Redis must remain optional unless explicitly required for a feature.
- If Redis is unavailable, the app should degrade gracefully where possible.
- Do not make local development require Redis for basic server/client startup.
- Presence, pub/sub, rate-limit, and cache features must have clear fallback behavior or clear startup errors.

## Performance rules

- Avoid `JSON.stringify` for deep equality on large world maps.
- Avoid full `worldBase` clone/diff on every small mutation.
- Use dirty-section deltas.
- Use incremental indexes for frequent lookups.
- Avoid O(provinces * countries) loops where an indexed O(active items) loop is possible.
- Keep WebSocket messages compact.
- Do not send full snapshots when replay deltas are available.
- Add diagnostics for message size and hot-path behavior when changing sync or resolve logic.

## Security rules

- Never commit secrets.
- Do not hardcode production JWT secrets.
- Keep development fallbacks clearly marked as development-only.
- Validate all uploaded files.
- Do not expose filesystem paths to clients.
- Do not allow arbitrary file reads from URL/path parameters.
- Keep admin-only operations protected on both REST and WS paths.

## Error handling rules

- Prefer explicit error codes over vague messages.
- Log server-side details; return safe client messages.
- Do not crash the server for one bad client message.
- Do not silently ignore failed game actions.
- Preserve enough context to debug failed turn resolution, delta generation, uploads, and admin changes.

## Testing and validation expectations

When adding or changing a system, include at least one of:

- typecheck coverage through strict types,
- isolated pure function tests,
- manual verification steps,
- admin/debug endpoint validation,
- documented test scenario.

Critical areas that need validation:

- order validation,
- turn resolution,
- delta generation/application,
- reconnect/replay behavior,
- private event routing,
- upload validation,
- map/province ID consistency,
- population percentage editing,
- extraction/deposit depletion.

## AI-agent workflow

Before editing:

1. Read `README.md`.
2. Inspect the relevant package `package.json`.
3. Inspect shared types if touching protocol, world state, orders, deltas, or WS messages.
4. Identify whether the change affects client, server, shared package, or all three.

During editing:

1. Make the smallest coherent change.
2. Keep client/server/shared contracts synchronized.
3. Avoid unrelated formatting churn.
4. Avoid broad rewrites unless requested.
5. Preserve existing Russian UI text unless replacing a whole screen/localization pattern.

After editing:

1. Run relevant typecheck/build commands.
2. Report commands run and results.
3. Report files changed.
4. Report any known limitations or untested paths.

## Do-not-break list

Do not break these without explicit approval:

- `npm run dev` root workflow.
- Server startup with SQLite fallback for development.
- `AUTH` / `AUTH_OK` login flow.
- `WORLD_DELTA` compact format.
- `WORLD_DELTA_ACK` and replay request semantics.
- Admin delta metrics endpoints.
- Province ID stability.
- MVT tile serving.
- Registration approval/admin notification flow.
- Existing uploaded flag/crest/content image URLs.
- Population modal data expectations.
- Building extraction and warehouse diagnostics.

## Commit and PR guidance

Use clear, scoped commit messages:

```text
Add population delta validation
Fix private event routing
Refactor construction queue indexing
Add admin province pagination guard
```

PR descriptions should include:

- what changed,
- why it changed,
- affected packages,
- commands run,
- known risks,
- screenshots for UI changes when applicable.

## Current project priorities

Prefer work that strengthens:

1. deterministic multiplayer WEGO flow,
2. world-state synchronization correctness,
3. map/province stability,
4. scalable turn resolution,
5. data-driven content systems,
6. admin/debug tooling,
7. readable modern strategy UI,
8. future modding support.

Avoid spending time on:

- cosmetic rewrites without UX impact,
- premature micro-optimizations outside hot paths,
- save compatibility guarantees before the data model stabilizes,
- copying mechanics from commercial games directly,
- large architectural rewrites without a staged migration plan.
