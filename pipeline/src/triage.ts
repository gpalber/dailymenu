// Triage: for every restaurant we have snapshots for, work out WHAT KIND of source the
// menu is in, so we know which extraction technique each one needs (and how far the free
// path can go). Writes eval/triage.json + prints a summary.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createDb, repoRoot } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { htmlToText, foldText, gunzip } from "./lib/util.js";

const COURSE_RE = /\b(primeros?|entrantes?|para (empezar|compartir)|segundos?|principales?|postres?)\b/g;
const MENU_RE = /menu (del dia|ejecutivo|diario|cerrado|de mediodia)/;
const PRICE_RE = /(\d{1,2})[.,](\d{2})\s*(?:€|eur)|(\d{1,2})\s*€/g;
// Images whose filename/alt suggests a menu photo (very common: chalkboard photos)
const IMG_MENU_RE = /<img[^>]+(src|alt)\s*=\s*["'][^"']*(men[uú]|carta)[^"']*["'][^>]*>/gi;

type Verdict =
  | "html_with_courses"   // dishes present in HTML text — fully parseable now, free
  | "html_price_only"     // menú + price but no dish structure
  | "html_mention_only"   // menú mentioned, no price, no dishes
  | "pdf"                 // menu lives in a PDF (needs PDF text extraction)
  | "image_only"          // menu is a picture (needs OCR or vision)
  | "js_or_empty"         // page renders client-side; our fetch sees nothing
  | "no_menu_signal";

const db = await createDb();
const store = await createSnapshotStore();

const rows = await db.query<{
  restaurant_id: string; name: string; website: string | null; r2_key: string;
  offers_menu: boolean | null; price_eur: string | null;
}>(
  `select distinct on (s.source_id)
     cs.restaurant_id, r.name, r.website, s.r2_key, mc.offers_menu,
     (select mo.price_eur::text from menu_offers mo
       where mo.restaurant_id = cs.restaurant_id and mo.is_current limit 1) as price_eur
   from snapshots s
   join crawl_sources cs on cs.id = s.source_id
   join restaurants r on r.id = cs.restaurant_id
   left join menu_classifications mc on mc.restaurant_id = cs.restaurant_id
   order by s.source_id, s.fetched_at desc`
);

// Group snapshots per restaurant; a restaurant's best snapshot wins
const byRestaurant = new Map<string, typeof rows>();
for (const r of rows)
  (byRestaurant.get(r.restaurant_id) ?? byRestaurant.set(r.restaurant_id, []).get(r.restaurant_id)!).push(r);

const RANK: Verdict[] = [
  "html_with_courses", "pdf", "image_only", "html_price_only", "html_mention_only", "js_or_empty", "no_menu_signal",
];

const results: {
  restaurant_id: string; name: string; website: string | null; verdict: Verdict;
  offers_menu: boolean | null; price_eur: string | null; course_hits: number; key: string;
}[] = [];

for (const [restaurantId, snaps] of byRestaurant) {
  let best: { verdict: Verdict; courseHits: number; key: string } | null = null;

  for (const snap of snaps) {
    let verdict: Verdict = "no_menu_signal";
    let courseHits = 0;

    if (snap.r2_key.endsWith(".pdf")) {
      verdict = "pdf";
    } else {
      const raw = await store.get(snap.r2_key);
      if (!raw) continue;
      const html = new TextDecoder("utf-8", { fatal: false }).decode(gunzip(raw));
      const text = foldText(htmlToText(html));
      const hasMenu = MENU_RE.test(text);
      COURSE_RE.lastIndex = 0;
      courseHits = new Set((text.match(COURSE_RE) ?? []).map((s) => s.replace(/s$/, ""))).size;
      PRICE_RE.lastIndex = 0;
      const hasPrice = PRICE_RE.test(text);
      IMG_MENU_RE.lastIndex = 0;
      const menuImages = (html.match(IMG_MENU_RE) ?? []).length;

      if (text.length < 250) verdict = "js_or_empty";
      else if (courseHits >= 2) verdict = "html_with_courses";
      else if (menuImages > 0 && hasMenu) verdict = "image_only";
      else if (hasMenu && hasPrice) verdict = "html_price_only";
      else if (hasMenu) verdict = "html_mention_only";
      else verdict = "no_menu_signal";
    }
    if (!best || RANK.indexOf(verdict) < RANK.indexOf(best.verdict))
      best = { verdict, courseHits, key: snap.r2_key };
  }
  if (!best) continue;
  results.push({
    restaurant_id: restaurantId, name: snaps[0].name, website: snaps[0].website,
    verdict: best.verdict, offers_menu: snaps[0].offers_menu, price_eur: snaps[0].price_eur,
    course_hits: best.courseHits, key: best.key,
  });
}

const counts: Record<string, number> = {};
for (const r of results) counts[r.verdict] = (counts[r.verdict] ?? 0) + 1;

const dir = join(await repoRoot(), "eval");
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "triage.json"), JSON.stringify(results, null, 2));

console.log(`triaged ${results.length} restaurants with snapshots\n`);
for (const v of RANK) if (counts[v]) console.log(`  ${v.padEnd(20)} ${counts[v]}`);
console.log(`\nbest candidates for full extraction (html_with_courses, most structure first):`);
for (const r of results.filter((x) => x.verdict === "html_with_courses").sort((a, b) => b.course_hits - a.course_hits).slice(0, 12))
  console.log(`  [${r.course_hits} courses] ${r.name} — ${r.website}`);
await db.close();
