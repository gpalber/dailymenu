// Apply in-session extractions (Claude reading stored snapshots) to the database.
// Same provenance discipline as any other extractor: every record links to the snapshot it
// came from and records model + prompt/schema version + confidence.
//
// Input: eval/session-extractions.json  — array of records, see type below.
// Usage: pnpm exec tsx pipeline/src/apply-extraction.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDb, migrate, repoRoot } from "@dailymenu/db";

const MODEL = "claude-session";
const PROMPT_VERSION = "session-extract-v1";
const SCHEMA_VERSION = "extract-1";

type Record_ = {
  restaurant_id: string;
  source_url_contains?: string;   // pick the snapshot whose crawl_source url matches
  offers_menu: boolean;
  kind: "menu_del_dia" | "menu_ejecutivo" | "menu_diario" | "menu_cerrado" | "other";
  price_eur: number | null;
  price_notes?: string | null;
  includes_text?: string | null;
  served_text?: string | null;
  freshness: "today" | "recent" | "typical";
  as_of_date?: string | null;
  confidence: number;
  dishes?: { course: "primero" | "segundo" | "postre" | "otro"; name: string }[];
  note?: string;
};

const root = await repoRoot();
const db = await createDb();
await migrate(db, join(root, "db/migrations"));

const records: Record_[] = JSON.parse(readFileSync(join(root, "eval/session-extractions.json"), "utf8"));
console.log(`applying ${records.length} in-session extractions (backend ${db.backend})`);

for (const rec of records) {
  // Resolve the snapshot this extraction is based on — provenance must point at real bytes.
  // Resolve `source_url_contains` as a SUFFIX first — so "terramundi.net/" picks the homepage
  // rather than a deeper page — then fall back to a substring match.
  const findSnapshot = (pattern?: string) =>
    db.query<{ id: string; url: string; fetched_at: string }>(
      `select s.id, cs.url, s.fetched_at::text
       from snapshots s join crawl_sources cs on cs.id = s.source_id
       where cs.restaurant_id = $1 ${pattern ? "and cs.url ilike $2" : ""}
       order by s.fetched_at desc limit 1`,
      pattern ? [rec.restaurant_id, pattern] : [rec.restaurant_id]
    );
  let snaps = await findSnapshot(rec.source_url_contains ? `%${rec.source_url_contains}` : undefined);
  if (snaps.length === 0 && rec.source_url_contains)
    snaps = await findSnapshot(`%${rec.source_url_contains}%`);
  if (snaps.length === 0) {
    console.warn(`  ! no snapshot for ${rec.restaurant_id} — skipped`);
    continue;
  }
  const snapshot = snaps[0];

  const [extraction] = await db.query<{ id: string }>(
    `insert into extractions (snapshot_id, task, model, prompt_version, schema_version, output, confidence)
     values ($1,'extract_menu',$2,$3,$4,$5,$6) returning id`,
    [snapshot.id, MODEL, PROMPT_VERSION, SCHEMA_VERSION, JSON.stringify(rec), rec.confidence]
  );

  await db.query(
    `insert into menu_classifications (restaurant_id, offers_menu, confidence, extraction_id, based_on_snapshot_at, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (restaurant_id) do update set offers_menu = $2, confidence = $3,
       extraction_id = $4, based_on_snapshot_at = $5, updated_at = now()`,
    [rec.restaurant_id, rec.offers_menu, rec.confidence, extraction.id, snapshot.fetched_at]
  );

  // Supersede prior machine-extracted offers; keep manual ones untouched.
  await db.query(
    `update menu_offers set is_current = false
     where restaurant_id = $1 and is_current and provenance = 'extracted'`,
    [rec.restaurant_id]
  );

  const [offer] = await db.query<{ id: string }>(
    `insert into menu_offers (restaurant_id, extraction_id, kind, price_eur, price_notes,
       includes_text, served_text, freshness, as_of_date, provenance)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'extracted') returning id`,
    [rec.restaurant_id, extraction.id, rec.kind, rec.price_eur, rec.price_notes ?? null,
     rec.includes_text ?? null, rec.served_text ?? null, rec.freshness, rec.as_of_date ?? null]
  );

  let position = 0;
  for (const dish of rec.dishes ?? []) {
    await db.query(
      `insert into dishes (menu_offer_id, course, name, position) values ($1,$2,$3,$4)`,
      [offer.id, dish.course, dish.name, position++]
    );
  }

  const [{ name }] = await db.query<{ name: string }>(`select name from restaurants where id = $1`, [rec.restaurant_id]);
  console.log(`  ✓ ${name}: ${rec.price_eur != null ? rec.price_eur + " €" : "sin precio"}, ${(rec.dishes ?? []).length} platos — ${snapshot.url}`);
}
await db.close();
