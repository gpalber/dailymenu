// heuristic-v1: deterministic has-menú classifier + conservative price extraction.
// Reads the latest snapshot per source, no LLM. Ambiguous cases land in the residue
// queue (classification null) for in-session review. Never fabricates: price is only
// written when exactly one plausible candidate appears near a menú phrase.
//
// Usage: tsx pipeline/src/classify-heuristic.ts [--limit N]
import { join } from "node:path";
import { createDb, migrate, repoRoot } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, foldText, gunzip } from "./lib/util.js";

const PROMPT_VERSION = "heuristic-v1";
const SCHEMA_VERSION = "classify-1";

const PHRASES: { re: RegExp; kind: string }[] = [
  { re: /menu del dia/g, kind: "menu_del_dia" },
  { re: /menu de mediodia/g, kind: "menu_del_dia" },
  { re: /menu diario/g, kind: "menu_diario" },
  { re: /menu ejecutivo/g, kind: "menu_ejecutivo" },
  { re: /menu cerrado/g, kind: "menu_cerrado" },
];
const NEGATION_RE = /(\bno\b|\bsin\b)[a-z ]{0,25}$/;
const PRICE_RE = /(\d{1,2})[.,](\d{2})\s*(?:€|eur)|(\d{1,2})\s*€/g;
const PRICE_MIN = 8, PRICE_MAX = 35;

const args = process.argv.slice(2);
const li = args.indexOf("--limit");
const LIMIT = li >= 0 ? Number(args[li + 1]) : Infinity;

const db = await createDb();
await migrate(db, join(await repoRoot(), "db/migrations"));
const store = await createSnapshotStore();

// Latest snapshot per source, grouped by restaurant
const rows = await db.query<{
  restaurant_id: string; source_id: string; snapshot_id: string; r2_key: string;
  content_type: string | null; fetched_at: string;
}>(
  `select distinct on (s.source_id)
     cs.restaurant_id, s.source_id, s.id as snapshot_id, s.r2_key, s.content_type, s.fetched_at
   from snapshots s join crawl_sources cs on cs.id = s.source_id
   order by s.source_id, s.fetched_at desc`
);
const byRestaurant = new Map<string, typeof rows>();
for (const r of rows) (byRestaurant.get(r.restaurant_id) ?? byRestaurant.set(r.restaurant_id, []).get(r.restaurant_id)!).push(r);

const stats = { restaurants: 0, offers_with_price: 0, offers_no_price: 0, no_menu: 0, residue: 0, pdf_only: 0 };

let n = 0;
for (const [restaurantId, snaps] of byRestaurant) {
  if (++n > LIMIT) break;
  stats.restaurants++;

  type Hit = { kind: string; negated: boolean; prices: number[]; snapshot_id: string };
  const hits: Hit[] = [];
  let textLen = 0;
  let htmlSnaps = 0;
  const snapshotIds: string[] = [];

  for (const snap of snaps) {
    snapshotIds.push(snap.snapshot_id);
    if (!snap.r2_key.endsWith(".html.gz")) continue; // PDFs: stored, parsed in Slice 2
    const raw = await store.get(snap.r2_key);
    if (!raw) continue;
    htmlSnaps++;
    const text = foldText(htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw))));
    textLen += text.length;
    for (const { re, kind } of PHRASES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 30), m.index);
        const window = text.slice(Math.max(0, m.index - 150), m.index + m[0].length + 150);
        const prices: number[] = [];
        PRICE_RE.lastIndex = 0;
        let pm;
        while ((pm = PRICE_RE.exec(window))) {
          const val = pm[1] ? Number(`${pm[1]}.${pm[2]}`) : Number(pm[3]);
          if (val >= PRICE_MIN && val <= PRICE_MAX) prices.push(val);
        }
        hits.push({ kind, negated: NEGATION_RE.test(before), prices, snapshot_id: snap.snapshot_id });
      }
    }
  }

  const positive = hits.filter((h) => !h.negated);
  const negatedOnly = hits.length > 0 && positive.length === 0;
  const allPrices = [...new Set(positive.flatMap((h) => h.prices).map((p) => p.toFixed(2)))].map(Number);

  let offers: boolean | null;
  let confidence: number | null;
  let residue: string | null = null;
  if (positive.length > 0) {
    offers = true;
    confidence = allPrices.length > 0 ? 0.95 : 0.8;
    if (allPrices.length > 1) residue = "ambiguous_price";
  } else if (negatedOnly) {
    offers = null; confidence = null; residue = "negated_mention";
  } else if (htmlSnaps === 0) {
    offers = null; confidence = null; residue = "pdf_only";
  } else if (textLen < 250) {
    offers = null; confidence = null; residue = "js_or_empty";
  } else {
    offers = false; confidence = 0.6;
  }

  const kind = positive[0]?.kind ?? null;
  const price = offers === true && allPrices.length === 1 ? allPrices[0] : null;
  const bestSnapshot = positive[0]?.snapshot_id ?? snaps[0].snapshot_id;

  const [extraction] = await db.query<{ id: string }>(
    `insert into extractions (snapshot_id, task, model, prompt_version, schema_version, output, confidence)
     values ($1,'classify_menu','heuristic-v1',$2,$3,$4,$5) returning id`,
    [bestSnapshot, PROMPT_VERSION, SCHEMA_VERSION,
     JSON.stringify({ offers, kind, hits: hits.length, negated: hits.length - positive.length,
       price_candidates: allPrices, residue_reason: residue, snapshot_ids: snapshotIds, text_len: textLen }),
     confidence]
  );

  await db.query(
    `insert into menu_classifications (restaurant_id, offers_menu, confidence, extraction_id, based_on_snapshot_at, updated_at)
     values ($1,$2,$3,$4,$5,now())
     on conflict (restaurant_id) do update set offers_menu = $2, confidence = $3,
       extraction_id = $4, based_on_snapshot_at = $5, updated_at = now()`,
    [restaurantId, offers, confidence, extraction.id, snaps[0].fetched_at]
  );

  if (offers === true) {
    await db.query(
      `update menu_offers set is_current = false where restaurant_id = $1 and provenance = 'extracted' and is_current`,
      [restaurantId]
    );
    await db.query(
      `insert into menu_offers (restaurant_id, extraction_id, kind, price_eur, freshness, provenance)
       values ($1,$2,$3,$4,'typical','extracted')`,
      [restaurantId, extraction.id, kind ?? "menu_del_dia", price]
    );
    if (price != null) stats.offers_with_price++; else stats.offers_no_price++;
  } else if (offers === false) stats.no_menu++;
  else { stats.residue++; if (residue === "pdf_only") stats.pdf_only++; }

  if (stats.restaurants % 100 === 0) console.log(`  …${stats.restaurants} classified`);
}

console.log(JSON.stringify(stats, null, 2));
await db.close();
