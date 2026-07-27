// One SQL interface, two backends:
//  - DATABASE_URL set  → postgres.js (Supabase in prod; works on Node and Workers)
//  - DATABASE_URL unset → embedded PGlite under .data/pglite (local dev only)
// All app SQL is plain parameterized Postgres, identical on both.

export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Multi-statement scripts (migrations). No parameters. */
  exec(text: string): Promise<void>;
  close(): Promise<void>;
  backend: "postgres" | "pglite";
}

/** Walk up from cwd to the pnpm workspace root, so dev paths don't depend on cwd. */
export async function repoRoot(): Promise<string> {
  const { existsSync } = await import("node:fs");
  const { dirname, join } = await import("node:path");
  let dir = process.cwd();
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const parent = dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
  return dir;
}

/** Load <repo root>/.env into process.env if present (no-op on Workers / when absent). */
export async function loadEnv(): Promise<void> {
  try {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const envPath = join(await repoRoot(), ".env");
    if (existsSync(envPath)) process.loadEnvFile(envPath);
  } catch {
    /* non-Node runtime or unreadable file — env vars must come from the platform */
  }
}

export async function createDb(databaseUrl?: string): Promise<Db> {
  await loadEnv();
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, { max: 5, prepare: false }); // prepare:false → pooler-friendly
    return {
      backend: "postgres",
      query: async (text, params = []) => (await sql.unsafe(text, params as never[])) as never,
      exec: async (text) => {
        await sql.unsafe(text);
      },
      close: () => sql.end({ timeout: 5 }),
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { mkdirSync } = await import("node:fs");
  const { join } = await import("node:path");
  const dataDir = join(await repoRoot(), ".data/pglite");
  mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  return {
    backend: "pglite",
    query: async (text, params = []) => (await pg.query(text, params as never[])).rows as never,
    exec: async (text) => {
      await pg.exec(text);
    },
    close: () => pg.close(),
  };
}

/** Apply db/migrations/*.sql in filename order, tracked in schema_migrations. */
export async function migrate(db: Db, migrationsDir: string): Promise<string[]> {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  await db.query(
    "create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())"
  );
  const applied = new Set(
    (await db.query<{ name: string }>("select name from schema_migrations")).map((r) => r.name)
  );
  const ran: string[] = [];
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await db.exec(sql);
    await db.query("insert into schema_migrations (name) values ($1)", [file]);
    ran.push(file);
  }
  return ran;
}
