# AGENTS.md

Rules for code in `apps/client/src`.

- Keep React UI, map code, stores, and API code separated.
- Use `@arcanorum/shared` for protocol types.
- Do not duplicate server contracts locally.
- The client is not authoritative.
- Apply world changes only from server messages or snapshot reloads.
- Keep large map and world-state selectors narrow.
- Avoid unnecessary rerenders in map and data-heavy panels.
- Preserve Russian UI text unless changing the whole screen.

Run after client changes:

```bash
npm run typecheck -w @arcanorum/client
npm run build -w @arcanorum/client
```
