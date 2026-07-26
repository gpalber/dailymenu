#!/usr/bin/env node
// OSM/Overpass seed: restaurants, bars, cafés in Centro / Salamanca / Chamberí (Madrid).
// Dependency-free (node built-ins only). Output: data/seed/restaurants.ndjson
// Data © OpenStreetMap contributors, ODbL — attribution is rendered in the app UI.

import { writeFileSync, mkdirSync } from "node:fs";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const DISTRICTS = ["Centro", "Salamanca", "Chamberí"];
const UA = "dailymenu/0.1 (Madrid menu-del-dia discovery; personal project)";

const query = (district) => `
[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="8"]["name"="Madrid"]->.madrid;
rel["boundary"="administrative"]["admin_level"="9"]["name"="${district}"](area.madrid);
map_to_area->.d;
nwr["amenity"~"^(restaurant|bar|cafe)$"]["name"](area.d);
out center tags;
`;

async function overpass(district) {
  let lastErr;
  for (const endpoint of ENDPOINTS) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": UA },
          body: "data=" + encodeURIComponent(query(district)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        console.error(`  retrying ${district} (${endpoint}, attempt ${attempt}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
  }
  throw lastErr;
}

function normalize(el, district, fetchedAt) {
  const t = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !t.name) return null;
  return {
    osm_type: el.type,
    osm_id: el.id,
    name: t.name.trim(),
    lat,
    lon,
    district,
    amenity: t.amenity,
    cuisine: t.cuisine ?? null,
    addr_street: t["addr:street"] ?? null,
    addr_housenumber: t["addr:housenumber"] ?? null,
    addr_postcode: t["addr:postcode"] ?? null,
    website: t.website ?? t["contact:website"] ?? null,
    instagram: t["contact:instagram"] ?? t.instagram ?? null,
    phone: t.phone ?? t["contact:phone"] ?? null,
    opening_hours_raw: t.opening_hours ?? null,
    osm_fetched_at: fetchedAt,
  };
}

const fetchedAt = new Date().toISOString();
const byKey = new Map(); // dedupe across district-boundary overlaps
const stats = {};

for (const district of DISTRICTS) {
  console.log(`Querying Overpass: ${district}…`);
  const json = await overpass(district);
  let kept = 0;
  for (const el of json.elements ?? []) {
    const row = normalize(el, district, fetchedAt);
    if (!row) continue;
    const key = `${row.osm_type}/${row.osm_id}`;
    if (!byKey.has(key)) {
      byKey.set(key, row);
      kept++;
    }
  }
  stats[district] = { returned: (json.elements ?? []).length, kept };
  console.log(`  ${district}: ${stats[district].returned} elements, ${kept} named venues kept`);
  await new Promise((r) => setTimeout(r, 2000)); // be polite between queries
}

mkdirSync("data/seed", { recursive: true });
const rows = [...byKey.values()];
writeFileSync("data/seed/restaurants.ndjson", rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

const byAmenity = {};
for (const r of rows) byAmenity[r.amenity] = (byAmenity[r.amenity] ?? 0) + 1;
const withSite = rows.filter((r) => r.website).length;
const withIg = rows.filter((r) => r.instagram).length;
const withHours = rows.filter((r) => r.opening_hours_raw).length;

console.log(`\nTotal: ${rows.length} venues → data/seed/restaurants.ndjson`);
console.log(`By amenity: ${JSON.stringify(byAmenity)}`);
console.log(
  `website: ${withSite} (${Math.round((100 * withSite) / rows.length)}%) · instagram: ${withIg} (${Math.round((100 * withIg) / rows.length)}%) · opening_hours: ${withHours} (${Math.round((100 * withHours) / rows.length)}%)`
);
