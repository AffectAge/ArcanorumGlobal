# AGENTS.md — Client

## Scope

This file applies to all code under `apps/client`.

The client is a Vite + React + TypeScript application for the ArcanorumGlobal grand strategy interface. It renders the map, UI panels, modals, charts, local previews, optimistic order overlays, and WebSocket-driven world state.

## Hard rules

- The client is not authoritative.
- Do not implement final game rules only in React components.
- The server validates orders and resolves turns.
- Client validation exists for UX only.
- Never duplicate protocol types from `@arcanorum/shared`.
- Do not import server code.
- Do not send heavy map geometry through WebSocket.
- Do not subscribe large components to the whole `worldBase` if they only need one section.

## Required checks

Run when client code changes:

```bash
npm run typecheck -w @arcanorum/client
npm run build -w @arcanorum/client
```

If shared types are changed too, also run:

```bash
npm run typecheck
npm run build
```

## Architecture rules

- Keep map rendering, UI panels, forms, charts, and WebSocket logic separated.
- Use Zustand stores or scoped hooks for client state.
- Use memoized selectors for large state sections.
- Keep optimistic state separate from confirmed `worldBase`.
- UI previews must be clearly derived from local pending orders.
- Official world changes must come from `AUTH_OK`, `WORLD_DELTA`, replay, or snapshot resync.

## WebSocket client rules

- Handle `AUTH_OK`, `ORDER_BROADCAST`, `WORLD_DELTA`, `NEWS_EVENT`, `UI_NOTIFY`, `PRESENCE`, `ERROR`, and `PONG` explicitly.
- Apply `WORLD_DELTA` in order.
- Send `WORLD_DELTA_ACK` only after successful application.
- Request replay when `worldStateVersion` has a gap.
- Fall back to snapshot resync only when replay is unavailable or invalid.
- Never assume a local order is accepted until the server confirms it or no rejection is returned after resolve.

## Map UI rules

- MapLibre owns geometry rendering.
- Gameplay state overlays must be lightweight and keyed by stable province IDs.
- Do not use province names as identifiers.
- Avoid full GeoJSON reprocessing in React render paths.
- Expensive map computations must be memoized or moved to preprocessing/build scripts.
- Keep `renderWorldCopies=false` behavior unless the world model is deliberately changed.

## React rules

- Components should be small, typed, and focused.
- Avoid giant all-purpose modals.
- Extract repeated controls into reusable components.
- Avoid inline heavy calculations inside JSX.
- Use `useMemo` and `useCallback` only for real stability/performance needs.
- Do not add unnecessary global state.
- Keep form schemas close to the form or shared if they are protocol-level.

## UI style rules

Target style: modern dark grand strategy UI.

- Dark graphite/charcoal surfaces.
- Clear hierarchy and dense information layout.
- Minimal decorative noise.
- Restrained animation.
- Legible text and icons at small sizes.
- No fantasy, RPG, or excessive neon styling unless explicitly requested.

## Localization/text rules

- Preserve existing Russian UI text unless the whole section is being converted deliberately.
- Do not mix Russian and English randomly in the same UI panel.
- Error text shown to the user must be clear and actionable.

## Forms and admin panels

- Validate forms with Zod or typed guards.
- Show server validation errors clearly.
- Admin operations must not pretend success before the server confirms.
- Use pagination/search for large province/content lists.
- Keep destructive admin actions explicit.

## Charts

- Use ECharts for dense analytical charts.
- Keep chart input data derived and memoized.
- Do not mutate world state when building chart data.
- Empty states must be handled explicitly.

## Do not break

- Root `npm run dev` workflow.
- Login/auth flow.
- World delta application.
- Replay/snapshot resync flow.
- Population modal expectations.
- Map province coloring and selection.
- Admin notification UI.
- Upload forms for flags, crests, content images, resource icons, and UI backgrounds.
