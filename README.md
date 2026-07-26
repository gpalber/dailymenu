# Menú del Día — Madrid

Discovery app for Madrid's *menú del día*: which places near you offer one, at what price,
with honest provenance and freshness labels on every fact.

- Plan & status: [tasks/todo.md](tasks/todo.md) · Data-sourcing legal assessment: [docs/data-sources.md](docs/data-sources.md) · Brief: [docs/brief.md](docs/brief.md)
- Stack: Cloudflare Workers (Hono API + static web) · Supabase Postgres · R2 snapshots · GitHub Actions pipeline · Anthropic Batch API extraction
- Data: base layer © OpenStreetMap contributors (ODbL); menus from restaurants' own sites (robots-honoring crawl); review evidence displayed live from the Tripadvisor Content API (never stored)

## Dev

```sh
pnpm install
pnpm seed:osm     # Overpass → data/seed/restaurants.ndjson
pnpm db:load      # → local PGlite (.data/) or DATABASE_URL if set
pnpm dev:api      # http://localhost:8787
pnpm dev:web      # http://localhost:5173 (proxies /api)
```

No `DATABASE_URL` → embedded PGlite dev DB (no services needed). Production uses Supabase; same migrations.
