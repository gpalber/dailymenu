import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createDb, migrate, repoRoot, type Db } from "@dailymenu/db";
import { createApp } from "./app.js";

let dbPromise: Promise<Db> | null = null;
const getDb = () =>
  (dbPromise ??= (async () => {
    const db = await createDb();
    const ran = await migrate(db, join(await repoRoot(), "db/migrations"));
    if (ran.length) console.log(`migrations applied: ${ran.join(", ")}`);
    console.log(`db backend: ${db.backend}`);
    return db;
  })());

const app = createApp(getDb);
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`api listening on http://localhost:${port}`));
