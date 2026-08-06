// One-shot: copy local .data/snapshots/* into R2 (same keys). Safe to re-run.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { repoRoot } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";

const store = await createSnapshotStore();
if (store.location !== "r2") {
  console.error("R2 store not available — nothing migrated");
  process.exit(1);
}
const root = join(await repoRoot(), ".data/snapshots");
const files: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else files.push(p);
  }
})(root);

let n = 0;
for (const file of files) {
  const key = relative(root, file).split(sep).join("/");
  const type = key.endsWith(".pdf") ? "application/pdf" : "application/gzip";
  await store.put(key, new Uint8Array(readFileSync(file)), type);
  n++;
}
console.log(`migrated ${n} snapshots (${Math.round(files.reduce((a, f) => a + statSync(f).size, 0) / 1024)} KiB) to R2`);
