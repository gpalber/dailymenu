// Cloudflare Workers entry. Requires wrangler.toml: compatibility_flags = ["nodejs_compat"]
// and a DATABASE_URL secret (Supabase session pooler). PGlite is never bundled here —
// this entry talks postgres.js directly.
import type { Db } from "@dailymenu/db";
import { createApp } from "./app.js";

type Env = { DATABASE_URL: string; ASSETS?: { fetch: (req: Request) => Promise<Response> } };

let db: Db | null = null;
async function getDbFor(env: Env): Promise<Db> {
  if (db) return db;
  const { default: postgres } = await import("postgres");
  const sql = postgres(env.DATABASE_URL, { max: 2, prepare: false, fetch_types: false });
  db = {
    backend: "postgres",
    query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never,
    close: () => sql.end({ timeout: 5 }),
  };
  return db;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api") || url.pathname === "/health") {
      const app = createApp(() => getDbFor(env));
      return app.fetch(request);
    }
    // Everything else: static web assets (configured in wrangler.toml at deploy time)
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("dailymenu api — see /health", { status: 200 });
  },
};
