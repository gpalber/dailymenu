// Ad-hoc read query runner: pnpm sql "select …"  (prints JSON lines)
import { createDb } from "@dailymenu/db";

const q = process.argv[2];
if (!q) { console.error('usage: pnpm sql "select …"'); process.exit(1); }
const db = await createDb();
try {
  const rows = await db.query(q);
  for (const r of rows) console.log(JSON.stringify(r));
  console.error(`(${rows.length} rows, backend ${db.backend})`);
} finally {
  await db.close();
}
