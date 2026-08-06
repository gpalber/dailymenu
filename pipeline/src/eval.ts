// Import labels (eval/labels.csv, same columns as the sample) and score heuristic-v1.
// Usage: tsx pipeline/src/eval.ts [--import]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createDb, repoRoot } from "@dailymenu/db";

const db = await createDb();
const root = await repoRoot();

if (process.argv.includes("--import")) {
  const file = join(root, "eval/labels.csv");
  if (!existsSync(file)) { console.error("eval/labels.csv not found"); process.exit(1); }
  const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
  let imported = 0;
  for (const line of lines) {
    // naive CSV split is fine: restaurant_id is col 0, labels are cols 4-5, names may contain commas but are quoted
    const cols = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"'));
    const [id, , , , hasMenu, price] = cols;
    if (!id || !hasMenu) continue;
    await db.query(
      `insert into eval_labels (restaurant_id, task, label, labeled_by)
       values ($1,'has_menu',$2,'alberto')
       on conflict (restaurant_id, task) do update set label = $2, labeled_at = now()`,
      [id, JSON.stringify({ has_menu: hasMenu.trim().toLowerCase() === "true" })]
    );
    if (price && price.trim()) {
      await db.query(
        `insert into eval_labels (restaurant_id, task, label, labeled_by)
         values ($1,'price',$2,'alberto')
         on conflict (restaurant_id, task) do update set label = $2, labeled_at = now()`,
        [id, JSON.stringify({ price: Number(price.replace(",", ".")) })]
      );
    }
    imported++;
  }
  console.log(`imported ${imported} has_menu labels`);
}

const rows = await db.query<{ truth: boolean; pred: boolean | null }>(
  `select (el.label->>'has_menu')::boolean as truth, mc.offers_menu as pred
   from eval_labels el
   left join menu_classifications mc on mc.restaurant_id = el.restaurant_id
   where el.task = 'has_menu'`
);
if (rows.length === 0) { console.log("no labels yet — fill eval/labels.csv and run with --import"); process.exit(0); }

let tp = 0, fp = 0, fn = 0, tn = 0, abstain = 0;
for (const r of rows) {
  if (r.pred === null) { abstain++; continue; }
  if (r.pred && r.truth) tp++;
  else if (r.pred && !r.truth) fp++;
  else if (!r.pred && r.truth) fn++;
  else tn++;
}
const p = tp / Math.max(tp + fp, 1), rec = tp / Math.max(tp + fn, 1);
console.log(`labels: ${rows.length} · abstained (residue): ${abstain}`);
console.log(`confusion: TP ${tp} · FP ${fp} · FN ${fn} · TN ${tn}`);
console.log(`precision ${(p * 100).toFixed(1)}% · recall ${(rec * 100).toFixed(1)}% · F1 ${((2 * p * rec) / Math.max(p + rec, 0.001) * 100).toFixed(1)}%`);

const priceRows = await db.query<{ truth: number; pred: string | null }>(
  `select (el.label->>'price')::float as truth, mo.price_eur::text as pred
   from eval_labels el
   left join menu_offers mo on mo.restaurant_id = el.restaurant_id and mo.is_current
   where el.task = 'price'`
);
if (priceRows.length) {
  const withPred = priceRows.filter((r) => r.pred != null);
  const exact = withPred.filter((r) => Math.abs(Number(r.pred) - r.truth) < 0.011).length;
  console.log(`price: ${priceRows.length} labeled · extracted for ${withPred.length} · exact-match ${exact}/${withPred.length}${withPred.length ? ` (${((exact / withPred.length) * 100).toFixed(0)}%)` : ""}`);
}
await db.close();
