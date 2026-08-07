// Dump the raw line structure of a snapshot (what the parser actually sees).
// Usage: pnpm exec tsx pipeline/src/peek-lines.ts "<name>" [urlFragment] [start] [count]
import { createDb } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, gunzip } from "./lib/util.js";
import { pdfToText } from "./lib/pdf.js";

const [needle, urlFrag, startS, countS] = process.argv.slice(2);
const start = Number(startS ?? 0);
const count = Number(countS ?? 40);

const db = await createDb();
const store = await createSnapshotStore();
const rows = await db.query<{ name: string; url: string; r2_key: string }>(
  `select distinct on (s.source_id) r.name, cs.url, s.r2_key
   from snapshots s join crawl_sources cs on cs.id = s.source_id join restaurants r on r.id = cs.restaurant_id
   where r.name ilike $1 ${urlFrag ? "and cs.url ilike $2" : ""}
   order by s.source_id, s.fetched_at desc limit 1`,
  urlFrag ? [`%${needle}%`, `%${urlFrag}%`] : [`%${needle}%`]
);
for (const row of rows) {
  const raw = await store.get(row.r2_key);
  if (!raw) continue;
  const text = row.r2_key.endsWith(".pdf")
    ? await pdfToText(raw)
    : htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw)));
  const lines = text.split("\n");
  console.log(`${row.url} — ${lines.length} lines total`);
  lines.slice(start, start + count).forEach((l, i) => console.log(`${String(start + i).padStart(4)}| ${JSON.stringify(l)}`));
}
await db.close();
