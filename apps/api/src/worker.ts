// Cloudflare Workers entry. Requires wrangler.toml: compatibility_flags = ["nodejs_compat"]
// and a DATABASE_URL secret (Supabase session pooler).
//
// One postgres connection PER REQUEST, closed via ctx.waitUntil: Workers do not allow
// reusing TCP sockets across requests, so a module-scoped pool intermittently 500s
// (observed live). Hyperdrive would make this cheap+pooled; needs a token permission
// we don't have yet — optional later optimization.
import type { Db } from "@dailymenu/db";
import { createApp } from "./app.js";

type Env = { DATABASE_URL: string; ASSETS?: { fetch: (req: Request) => Promise<Response> } };

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api") || url.pathname === "/health") {
      const { default: postgres } = await import("postgres");
      const sql = postgres(env.DATABASE_URL, { max: 2, prepare: false, fetch_types: false, connect_timeout: 10 });
      const db: Db = {
        backend: "postgres",
        query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never,
        exec: async (text) => {
          await sql.unsafe(text);
        },
        close: () => sql.end({ timeout: 5 }),
      };
      try {
        const app = createApp(() => Promise.resolve(db));
        const res = await app.fetch(request);
        return res;
      } finally {
        ctx.waitUntil(db.close());
      }
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("dailymenu api — see /health", { status: 200 });
  },
};
