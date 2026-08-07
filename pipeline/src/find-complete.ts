// Find restaurants whose snapshot contains a menú-del-día BLOCK with dishes inside it
// (as opposed to an à-la-carte carta that merely uses the same course words).
// This is the "complete record" candidate list — the thing worth extracting fully.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDb, repoRoot } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, foldText, gunzip } from "./lib/util.js";

const MENU_RE = /menu (del dia|ejecutivo|diario|de mediodia)/g;
const COURSE_RE = /\b(primeros?|entrantes?|segundos?|principales?|postres?)\b/g;
const WINDOW = 2500; // chars after the menú mention to look for its dish block

const db = await createDb();
const store = await createSnapshotStore();

const rows = await db.query<{ restaurant_id: string; name: string; url: string; r2_key: string }>(
  `select distinct on (s.source_id) cs.restaurant_id, r.name, cs.url, s.r2_key
   from snapshots s
   join crawl_sources cs on cs.id = s.source_id
   join restaurants r on r.id = cs.restaurant_id
   where s.r2_key like '%.html.gz'
   order by s.source_id, s.fetched_at desc`
);

type Hit = { restaurant_id: string; name: string; url: string; courses: number; dishLines: number; score: number; excerpt: string };
const hits: Hit[] = [];

for (const row of rows) {
  const raw = await store.get(row.r2_key);
  if (!raw) continue;
  const text = htmlToText(new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw)));
  const folded = foldText(text);
  MENU_RE.lastIndex = 0;
  let m;
  while ((m = MENU_RE.exec(folded))) {
    const block = folded.slice(m.index, m.index + WINDOW);
    COURSE_RE.lastIndex = 0;
    const courses = new Set((block.match(COURSE_RE) ?? []).map((s) => s.replace(/s$/, ""))).size;
    // dish-like lines: short-ish, wordy, no euro sign, inside the block
    const dishLines = text
      .slice(m.index, m.index + WINDOW)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length >= 6 && l.length <= 70 && /[a-záéíóúñ]{4}/i.test(l) && !/€/.test(l) && !/^(menu|carta|reserv|inicio|contact)/i.test(l)).length;
    const score = courses * 3 + Math.min(dishLines, 20);
    if (courses >= 2 && dishLines >= 4)
      hits.push({ restaurant_id: row.restaurant_id, name: row.name, url: row.url, courses, dishLines, score, excerpt: text.slice(m.index, m.index + 220).replace(/\s+/g, " ") });
    break; // one hit per snapshot is enough
  }
}

hits.sort((a, b) => b.score - a.score);
const dir = join(await repoRoot(), "eval");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "complete-candidates.json"), JSON.stringify(hits, null, 2));
console.log(`${hits.length} restaurants have a menú-del-día block with dish content nearby\n`);
for (const h of hits.slice(0, 20)) console.log(`  [${h.courses}c/${h.dishLines}d] ${h.name} — ${h.url}`);
await db.close();
