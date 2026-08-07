// Smoke-test / inspect PDF text extraction on stored menu PDFs.
// Usage: pnpm exec tsx pipeline/src/peek-pdf.ts [count] ["name fragment"]
import { createDb } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { pdfToText } from "./lib/pdf.js";

const count = Number(process.argv[2] ?? 4);
const needle = process.argv[3];
const db = await createDb();
const store = await createSnapshotStore();

const rows = await db.query<{ name: string; url: string; r2_key: string }>(
  `select r.name, cs.url, s.r2_key
   from snapshots s
   join crawl_sources cs on cs.id = s.source_id
   join restaurants r on r.id = cs.restaurant_id
   where s.r2_key like '%.pdf' ${needle ? "and r.name ilike $2" : ""}
   order by r.name limit $1`,
  needle ? [count, `%${needle}%`] : [count]
);

for (const row of rows) {
  const raw = await store.get(row.r2_key);
  if (!raw) { console.log(`MISSING ${row.name}`); continue; }
  try {
    const text = await pdfToText(raw);
    console.log(`\n=== ${row.name} — ${row.url} (${text.length} chars)`);
    console.log(text.slice(0, 800));
  } catch (err) {
    console.log(`FAIL ${row.name}: ${err instanceof Error ? err.message : err}`);
  }
}
await db.close();
