// Draw a simple random (hash-ordered, reproducible) sample of 100 crawled restaurants
// for hand-labeling. Output: eval/sample-to-label.csv (committed — labels are project data).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDb, repoRoot } from "@dailymenu/db";

const db = await createDb();
const rows = await db.query<{ id: string; name: string; district: string; website: string }>(
  `select id, name, district, website from (
     select distinct r.id, r.name, r.district, r.website
     from restaurants r
     join crawl_sources cs on cs.restaurant_id = r.id
     join snapshots s on s.source_id = cs.id
   ) t order by md5(id::text) limit 100`
);
const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
const csv = [
  "restaurant_id,name,district,website,label_has_menu,label_price,notes",
  ...rows.map((r) => [r.id, esc(r.name), r.district, esc(r.website), "", "", ""].join(",")),
].join("\n");
const dir = join(await repoRoot(), "eval");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "sample-to-label.csv"), csv + "\n");
console.log(`wrote eval/sample-to-label.csv with ${rows.length} rows
label_has_menu: true/false (does the restaurant offer a menú del día / ejecutivo / diario?)
label_price:   number like 14.50 when the menú price is visible on their site (else blank)`);
await db.close();
