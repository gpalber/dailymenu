// Print the text of a restaurant's best snapshot, windowed around menú mentions.
// This is what lets Claude do in-session extraction from stored data (no re-crawl, no API cost).
// Usage: pnpm exec tsx pipeline/src/show-snapshot.ts "<name fragment>" [--full] [--chars N]
import { createDb } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, foldText, gunzip } from "./lib/util.js";

const needle = process.argv[2];
const full = process.argv.includes("--full");
const ci = process.argv.indexOf("--chars");
const CHARS = ci >= 0 ? Number(process.argv[ci + 1]) : 2200;
if (!needle) { console.error('usage: show-snapshot "<name fragment>" [--full]'); process.exit(1); }

const db = await createDb();
const store = await createSnapshotStore();
const rows = await db.query<{ id: string; name: string; website: string; r2_key: string; url: string; fetched_at: string }>(
  `select r.id, r.name, r.website, s.r2_key, cs.url, s.fetched_at::text
   from snapshots s
   join crawl_sources cs on cs.id = s.source_id
   join restaurants r on r.id = cs.restaurant_id
   where r.name ilike $1 and s.r2_key like '%.html.gz'
   order by r.name, s.fetched_at desc`,
  [`%${needle}%`]
);
if (rows.length === 0) { console.error("no html snapshots for that name"); process.exit(1); }

for (const row of rows) {
  const raw = await store.get(row.r2_key);
  if (!raw) continue;
  const text = htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw)));
  console.log(`\n${"=".repeat(70)}\n${row.name} — ${row.url}\n  restaurant_id: ${row.id}\n  fetched: ${row.fetched_at}\n${"=".repeat(70)}`);
  if (full) { console.log(text.slice(0, 20000)); continue; }
  const folded = foldText(text);
  const idx = folded.search(/menu (del dia|ejecutivo|diario|de mediodia)|primeros?|entrantes/);
  const start = Math.max(0, idx - 300);
  console.log(text.slice(start, start + CHARS));
}
await db.close();
