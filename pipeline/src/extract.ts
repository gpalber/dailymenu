// heuristic-v2: run the menú-block parser over every stored snapshot (HTML *and* PDF)
// and write classification + offer + dishes with full provenance. No LLM, no network.
//
// Records written by `claude-session` (in-session extraction) are never overwritten —
// a human/model reading of a page outranks the regex parser.
//
// Usage: pnpm extract [--limit N] [--dry]
import { join } from "node:path";
import { createDb, migrate, repoRoot } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, gunzip } from "./lib/util.js";
import { pdfToText } from "./lib/pdf.js";
import { parseMenu, type ParsedMenu } from "./lib/menu-parse.js";

const PROMPT_VERSION = "heuristic-v2";
const SCHEMA_VERSION = "extract-2";

const args = process.argv.slice(2);
const li = args.indexOf("--limit");
const LIMIT = li >= 0 ? Number(args[li + 1]) : Infinity;
const DRY = args.includes("--dry");

const db = await createDb();
await migrate(db, join(await repoRoot(), "db/migrations"));
const store = await createSnapshotStore();

// Restaurants already covered by an in-session extraction — leave them alone.
const protectedIds = new Set(
  (
    await db.query<{ restaurant_id: string }>(
      `select distinct mo.restaurant_id from menu_offers mo
       join extractions e on e.id = mo.extraction_id
       where mo.is_current and e.model = 'claude-session'`
    )
  ).map((r) => r.restaurant_id)
);

const snaps = await db.query<{
  restaurant_id: string; name: string; source_id: string; snapshot_id: string;
  r2_key: string; fetched_at: string;
}>(
  `select distinct on (s.source_id)
     cs.restaurant_id, r.name, s.source_id, s.id as snapshot_id, s.r2_key, s.fetched_at::text
   from snapshots s
   join crawl_sources cs on cs.id = s.source_id
   join restaurants r on r.id = cs.restaurant_id
   order by s.source_id, s.fetched_at desc`
);

const byRestaurant = new Map<string, typeof snaps>();
for (const s of snaps)
  (byRestaurant.get(s.restaurant_id) ?? byRestaurant.set(s.restaurant_id, []).get(s.restaurant_id)!).push(s);

const stats = {
  restaurants: 0, skipped_protected: 0, with_dishes: 0, with_price: 0,
  menu_only: 0, no_menu: 0, unreadable: 0, pdf_parsed: 0, pdf_failed: 0, dishes_total: 0,
};

let n = 0;
for (const [restaurantId, list] of byRestaurant) {
  if (++n > LIMIT) break;
  if (protectedIds.has(restaurantId)) { stats.skipped_protected++; continue; }
  stats.restaurants++;

  // Parse every snapshot for this restaurant; keep the richest result.
  let best: { parsed: ParsedMenu; snapshotId: string; fetchedAt: string } | null = null;
  let sawReadable = false;

  for (const snap of list) {
    const raw = await store.get(snap.r2_key);
    if (!raw) continue;
    let text: string;
    if (snap.r2_key.endsWith(".pdf")) {
      try { text = await pdfToText(raw); stats.pdf_parsed++; }
      catch { stats.pdf_failed++; continue; }
    } else {
      text = htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw)));
    }
    if (text.trim().length >= 200) sawReadable = true;
    const parsed = parseMenu(text);
    const score = (parsed.offers ? 100 : 0) + parsed.dishes.length * 5 + (parsed.price_eur != null ? 10 : 0);
    const bestScore = best ? (best.parsed.offers ? 100 : 0) + best.parsed.dishes.length * 5 + (best.parsed.price_eur != null ? 10 : 0) : -1;
    if (score > bestScore) best = { parsed, snapshotId: snap.snapshot_id, fetchedAt: snap.fetched_at };
  }

  if (!best) { stats.unreadable++; continue; }
  const p = best.parsed;
  const offers = p.offers === true ? true : sawReadable ? false : null;
  if (offers === null) stats.unreadable++;
  else if (!offers) stats.no_menu++;
  else if (p.dishes.length) { stats.with_dishes++; stats.dishes_total += p.dishes.length; }
  else if (p.price_eur != null) stats.with_price++;
  else stats.menu_only++;

  if (DRY) continue;

  const [extraction] = await db.query<{ id: string }>(
    `insert into extractions (snapshot_id, task, model, prompt_version, schema_version, output, confidence)
     values ($1,'extract_menu','heuristic-v2',$2,$3,$4,$5) returning id`,
    [best.snapshotId, PROMPT_VERSION, SCHEMA_VERSION, JSON.stringify(p), p.confidence]
  );

  await db.query(
    `insert into menu_classifications (restaurant_id, offers_menu, confidence, extraction_id, based_on_snapshot_at, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (restaurant_id) do update set offers_menu = $2, confidence = $3,
       extraction_id = $4, based_on_snapshot_at = $5, updated_at = now()`,
    [restaurantId, offers, p.confidence, extraction.id, best.fetchedAt]
  );

  await db.query(
    `update menu_offers set is_current = false where restaurant_id = $1 and is_current and provenance = 'extracted'`,
    [restaurantId]
  );

  if (offers === true) {
    const [offer] = await db.query<{ id: string }>(
      `insert into menu_offers (restaurant_id, extraction_id, kind, price_eur, price_notes,
         includes_text, freshness, provenance)
       values ($1,$2,$3,$4,$5,$6,'typical','extracted') returning id`,
      [restaurantId, extraction.id, p.kind ?? "menu_del_dia", p.price_eur, p.price_notes, p.includes_text]
    );
    let position = 0;
    for (const d of p.dishes)
      await db.query(`insert into dishes (menu_offer_id, course, name, position) values ($1,$2,$3,$4)`,
        [offer.id, d.course, d.name, position++]);
  }

  if (stats.restaurants % 100 === 0) console.log(`  …${stats.restaurants} processed`);
}

console.log(JSON.stringify(stats, null, 2));
await db.close();
