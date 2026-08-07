// Show what heuristic-v2 would extract for a named restaurant, without writing anything.
// Usage: pnpm exec tsx pipeline/src/peek-parse.ts "<name fragment>"
import { createDb } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, gunzip } from "./lib/util.js";
import { pdfToText } from "./lib/pdf.js";
import { parseMenu } from "./lib/menu-parse.js";

const needle = process.argv[2];
if (!needle) { console.error('usage: peek-parse "<name fragment>"'); process.exit(1); }

const db = await createDb();
const store = await createSnapshotStore();
const rows = await db.query<{ name: string; url: string; r2_key: string }>(
  `select distinct on (s.source_id) r.name, cs.url, s.r2_key
   from snapshots s join crawl_sources cs on cs.id = s.source_id join restaurants r on r.id = cs.restaurant_id
   where r.name ilike $1 order by s.source_id, s.fetched_at desc`,
  [`%${needle}%`]
);

for (const row of rows) {
  const raw = await store.get(row.r2_key);
  if (!raw) continue;
  let text: string;
  try {
    text = row.r2_key.endsWith(".pdf")
      ? await pdfToText(raw)
      : htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw)));
  } catch (e) { console.log(`FAIL ${row.url}`); continue; }
  const p = parseMenu(text);
  if (!p.offers && p.dishes.length === 0) { console.log(`— ${row.url}: ${p.reason}`); continue; }
  console.log(`\n=== ${row.name} — ${row.url}`);
  console.log(`   ${p.reason} · conf ${p.confidence} · kind ${p.kind} · price ${p.price_eur ?? "—"} · candidates [${p.price_candidates}]`);
  if (p.includes_text) console.log(`   incluye: ${p.includes_text}`);
  for (const course of ["primero", "segundo", "postre", "otro"]) {
    const items = p.dishes.filter((d) => d.course === course);
    if (items.length) console.log(`   ${course}: ${items.map((d) => d.name).join(" | ")}`);
  }
}
await db.close();
