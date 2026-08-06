// Robots-honoring crawler. Fetches each restaurant's website, discovers likely menu
// pages/PDFs one level deep, stores content-hashed snapshots (R2 or local), and records
// everything in crawl_sources/snapshots. Politeness: per-host sequential, ≥1s delay,
// identified UA, 12s timeout, 2.5MB cap.
//
// Usage: tsx pipeline/src/crawl.ts [--limit N] [--district Centro]
import { join } from "node:path";
import { createDb, migrate, repoRoot } from "@dailymenu/db";
import { createSnapshotStore } from "./lib/snapshots.js";
import { robotsFor } from "./lib/robots.js";
import { normalizeUrl, fetchWithTimeout, extractLinks, foldText, sha256hex, gz, sleep } from "./lib/util.js";

const args = process.argv.slice(2);
const argVal = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const LIMIT = argVal("limit") ? Number(argVal("limit")) : Infinity;
const DISTRICT = argVal("district");
const HOST_CONCURRENCY = 8;
const MENU_LINK_RE = /(men[u]|carta|comer|mediodi|gastronom)/; // applied to folded text/href

const db = await createDb();
await migrate(db, join(await repoRoot(), "db/migrations"));
const store = await createSnapshotStore();
console.log(`snapshot store: ${store.location}`);

// Ensure every restaurant with a website has a crawl_sources row
await db.query(
  `insert into crawl_sources (restaurant_id, url, kind, discovered_via)
   select id, website, 'website', coalesce(website_source, 'osm')
   from restaurants where website is not null
   on conflict (restaurant_id, url) do nothing`
);

type Src = {
  id: string; restaurant_id: string; url: string; kind: string;
  last_content_hash: string | null; district: string;
};
const sources = await db.query<Src>(
  `select cs.id, cs.restaurant_id, cs.url, cs.kind, cs.last_content_hash, r.district
   from crawl_sources cs join restaurants r on r.id = cs.restaurant_id
   where cs.active ${DISTRICT ? "and r.district = $1" : ""}
   order by cs.restaurant_id`,
  DISTRICT ? [DISTRICT] : []
);

// Respect --limit by restaurant (not by source) so a restaurant's pages stay together
const restaurantOrder = [...new Set(sources.map((s) => s.restaurant_id))].slice(
  0,
  Number.isFinite(LIMIT) ? LIMIT : undefined
);
const chosen = new Set(restaurantOrder);
const work = sources.filter((s) => chosen.has(s.restaurant_id));

// Group by host so politeness is per-host
const byHost = new Map<string, Src[]>();
let badUrl = 0;
for (const s of work) {
  const norm = normalizeUrl(s.url);
  if (!norm) { badUrl++; continue; }
  const host = new URL(norm).host;
  s.url = norm;
  (byHost.get(host) ?? byHost.set(host, []).get(host)!).push(s);
}

const stats = {
  hosts: byHost.size, sources: work.length, bad_url: badUrl, robots_blocked: 0,
  fetch_errors: 0, http_4xx_5xx: 0, unchanged: 0, stored: 0, menu_pages_found: 0, pdfs_found: 0,
};

async function upsertDiscovered(restaurantId: string, url: string, kind: "menu_page" | "pdf") {
  const rows = await db.query<{ id: string }>(
    `insert into crawl_sources (restaurant_id, url, kind, discovered_via)
     values ($1,$2,$3,'crawl')
     on conflict (restaurant_id, url) do nothing
     returning id`,
    [restaurantId, url, kind]
  );
  if (rows.length) {
    if (kind === "pdf") stats.pdfs_found++;
    else stats.menu_pages_found++;
    return rows[0].id;
  }
  return null;
}

async function crawlOne(src: Src, robotsAllowed: boolean, crawlDelayMs: number): Promise<void> {
  const path = new URL(src.url).pathname || "/";
  if (!robotsAllowed) {
    stats.robots_blocked++;
    await db.query(`update crawl_sources set robots_allowed = false where id = $1`, [src.id]);
    return;
  }
  const res = await fetchWithTimeout(src.url);
  if ("error" in res) {
    stats.fetch_errors++;
    return;
  }
  if (res.status >= 400) {
    stats.http_4xx_5xx++;
    await db.query(`update crawl_sources set robots_allowed = true, last_fetched_at = now() where id = $1`, [src.id]);
    return;
  }
  const isPdf = res.contentType === "application/pdf" || src.url.toLowerCase().endsWith(".pdf");
  const hash = sha256hex(res.body);
  if (hash === src.last_content_hash) {
    stats.unchanged++;
    await db.query(`update crawl_sources set last_fetched_at = now(), robots_allowed = true where id = $1`, [src.id]);
    return;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const key = isPdf
    ? `snap/${src.id}/${ts}-${hash.slice(0, 8)}.pdf`
    : `snap/${src.id}/${ts}-${hash.slice(0, 8)}.html.gz`;
  await store.put(key, isPdf ? res.body : gz(res.body), isPdf ? "application/pdf" : "application/gzip");
  await db.query(
    `insert into snapshots (source_id, r2_key, content_hash, http_status, content_type) values ($1,$2,$3,$4,$5)`,
    [src.id, key, hash, res.status, res.contentType]
  );
  await db.query(
    `update crawl_sources set last_fetched_at = now(), last_content_hash = $2, robots_allowed = true where id = $1`,
    [src.id, hash]
  );
  stats.stored++;

  // One-level menu-link discovery from the homepage
  if (src.kind === "website" && !isPdf && res.contentType.includes("html")) {
    const html = new TextDecoder("utf-8", { fatal: false }).decode(res.body);
    const links = extractLinks(html, src.url);
    const sameHost = links.filter((l) => {
      try { return new URL(l.href).host === new URL(src.url).host; } catch { return false; }
    });
    const menuish = sameHost.filter(
      (l) => MENU_LINK_RE.test(foldText(l.href)) || MENU_LINK_RE.test(foldText(l.text))
    );
    const seen = new Set<string>([src.url]);
    let htmlTaken = 0, pdfTaken = 0;
    for (const l of menuish) {
      const clean = l.href.replace(/#.*$/, "");
      if (seen.has(clean)) continue;
      seen.add(clean);
      const isPdfLink = /\.pdf(\?|$)/i.test(clean);
      if (isPdfLink && pdfTaken < 2) { pdfTaken++; await upsertDiscovered(src.restaurant_id, clean, "pdf"); }
      else if (!isPdfLink && htmlTaken < 2) { htmlTaken++; await upsertDiscovered(src.restaurant_id, clean, "menu_page"); }
      if (htmlTaken >= 2 && pdfTaken >= 2) break;
    }
  }
  await sleep(Math.max(crawlDelayMs, 1000));
}

const hosts = [...byHost.entries()];
let cursor = 0;
let done = 0;
const t0 = Date.now();

async function worker(): Promise<void> {
  for (;;) {
    const idx = cursor++;
    if (idx >= hosts.length) return;
    const [host, srcs] = hosts[idx];
    try {
      const origin = new URL(srcs[0].url).origin;
      const robots = await robotsFor(origin);
      for (const s of srcs) {
        const allowed = robots.isAllowed(new URL(s.url).pathname || "/");
        await crawlOne(s, allowed, robots.crawlDelayMs);
      }
    } catch (err) {
      stats.fetch_errors++;
      console.error(`host ${host}: ${err instanceof Error ? err.message : err}`);
    }
    done++;
    if (done % 50 === 0)
      console.log(`  …${done}/${hosts.length} hosts (${Math.round((Date.now() - t0) / 1000)}s)`);
  }
}
await Promise.all(Array.from({ length: HOST_CONCURRENCY }, worker));

// Crawl any sources discovered in this run (menu pages / PDFs) that have no snapshot yet
const fresh = await db.query<Src>(
  `select cs.id, cs.restaurant_id, cs.url, cs.kind, cs.last_content_hash, r.district
   from crawl_sources cs join restaurants r on r.id = cs.restaurant_id
   where cs.active and cs.last_fetched_at is null and cs.discovered_via = 'crawl'
     and cs.restaurant_id = any($1)`,
  [restaurantOrder]
);
if (fresh.length) {
  console.log(`crawling ${fresh.length} discovered menu pages/PDFs…`);
  const byHost2 = new Map<string, Src[]>();
  for (const s of fresh) {
    const norm = normalizeUrl(s.url);
    if (!norm) continue;
    s.url = norm;
    const host = new URL(norm).host;
    (byHost2.get(host) ?? byHost2.set(host, []).get(host)!).push(s);
  }
  const hosts2 = [...byHost2.entries()];
  let cursor2 = 0;
  await Promise.all(
    Array.from({ length: HOST_CONCURRENCY }, async () => {
      for (;;) {
        const idx = cursor2++;
        if (idx >= hosts2.length) return;
        const [, srcs] = hosts2[idx];
        try {
          const robots = await robotsFor(new URL(srcs[0].url).origin);
          for (const s of srcs) await crawlOne(s, robots.isAllowed(new URL(s.url).pathname || "/"), robots.crawlDelayMs);
        } catch (err) {
          stats.fetch_errors++;
        }
      }
    })
  );
}

console.log(`\ncrawl done in ${Math.round((Date.now() - t0) / 1000)}s`);
console.log(JSON.stringify(stats, null, 2));
await db.close();
