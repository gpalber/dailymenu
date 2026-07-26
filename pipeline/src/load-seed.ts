// Load data/seed/restaurants.ndjson into the DB (upsert on osm_type+osm_id).
// Website precedence: a website discovered elsewhere (tripadvisor/brave/manual) is never
// clobbered by OSM; an OSM-sourced website follows the OSM tag (including removal).
import { readFileSync } from "node:fs";
import { createDb, migrate } from "@dailymenu/db";

const db = await createDb();
const ran = await migrate(db, "db/migrations");
if (ran.length) console.log(`migrations applied: ${ran.join(", ")}`);

const lines = readFileSync("data/seed/restaurants.ndjson", "utf8").trim().split("\n");
console.log(`loading ${lines.length} rows (backend: ${db.backend})…`);

let n = 0;
for (const line of lines) {
  const r = JSON.parse(line);
  await db.query(
    `insert into restaurants (osm_type, osm_id, name, lat, lon, district, amenity, cuisine,
       addr_street, addr_housenumber, addr_postcode, website, website_source, instagram, phone,
       opening_hours_raw, osm_fetched_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     on conflict (osm_type, osm_id) do update set
       name = excluded.name, lat = excluded.lat, lon = excluded.lon,
       district = excluded.district, amenity = excluded.amenity, cuisine = excluded.cuisine,
       addr_street = excluded.addr_street, addr_housenumber = excluded.addr_housenumber,
       addr_postcode = excluded.addr_postcode, instagram = excluded.instagram,
       phone = excluded.phone, opening_hours_raw = excluded.opening_hours_raw,
       osm_fetched_at = excluded.osm_fetched_at, updated_at = now(),
       website = case
         when restaurants.website is null or restaurants.website_source = 'osm'
           then excluded.website else restaurants.website end,
       website_source = case
         when restaurants.website is null or restaurants.website_source = 'osm'
           then (case when excluded.website is not null then 'osm' end)
         else restaurants.website_source end`,
    [
      r.osm_type, r.osm_id, r.name, r.lat, r.lon, r.district, r.amenity, r.cuisine,
      r.addr_street, r.addr_housenumber, r.addr_postcode, r.website,
      r.website ? "osm" : null, r.instagram, r.phone,
      r.opening_hours_raw, r.osm_fetched_at,
    ]
  );
  n++;
}

const [{ total }] = await db.query<{ total: number | string }>(
  "select count(*)::int as total from restaurants"
);
const byDistrict = await db.query<{ district: string; n: number }>(
  "select district, count(*)::int as n from restaurants group by district order by n desc"
);
console.log(`upserted ${n}; restaurants in db: ${total}`);
for (const d of byDistrict) console.log(`  ${d.district}: ${d.n}`);
await db.close();
