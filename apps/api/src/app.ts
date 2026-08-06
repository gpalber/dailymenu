import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Db } from "@dailymenu/db";

const OSM_ATTRIBUTION = "Datos de restaurantes © OpenStreetMap contributors (ODbL)" as const;

// Shared SELECT: restaurant + latest classification + current offer + its provenance chain
// (offer → extraction → snapshot → crawl_source URL). Manual offers carry verified_at instead.
const BASE_SELECT = `
  select r.id, r.name, r.lat, r.lon, r.district, r.amenity, r.cuisine, r.website,
         r.addr_street, r.addr_housenumber, r.addr_postcode, r.instagram, r.phone,
         r.opening_hours_raw, r.osm_type, r.osm_id,
         mc.offers_menu, mc.confidence as classification_confidence,
         mo.id as offer_id, mo.kind as offer_kind, mo.price_eur, mo.price_notes,
         mo.freshness, mo.as_of_date, mo.provenance as offer_provenance, mo.verified_at,
         s.fetched_at as snapshot_fetched_at, cs.url as source_url
  from restaurants r
  left join menu_classifications mc on mc.restaurant_id = r.id
  left join lateral (
    select * from menu_offers mo2
    where mo2.restaurant_id = r.id and mo2.is_current
    order by mo2.created_at desc limit 1
  ) mo on true
  left join extractions e on e.id = mo.extraction_id
  left join snapshots s on s.id = e.snapshot_id
  left join crawl_sources cs on cs.id = s.source_id
`;

type Row = Record<string, unknown> & { id: string };

function toSummary(row: Row, distanceM: number | null) {
  const hasOffer = row.offer_id != null;
  return {
    id: row.id,
    name: row.name,
    lat: Number(row.lat),
    lon: Number(row.lon),
    district: row.district,
    amenity: row.amenity,
    cuisine: row.cuisine ?? null,
    website: row.website ?? null,
    distance_m: distanceM,
    classification: {
      offers_menu: (row.offers_menu as boolean | null) ?? null,
      confidence: row.classification_confidence != null ? Number(row.classification_confidence) : null,
    },
    current_offer: hasOffer
      ? {
          kind: row.offer_kind,
          price_eur: row.price_eur != null ? Number(row.price_eur) : null,
          price_notes: row.price_notes ?? null,
          freshness: row.freshness,
          as_of_date: row.as_of_date ?? null,
          provenance: {
            source_url: (row.source_url as string | null) ?? null,
            fetched_at:
              ((row.snapshot_fetched_at ?? row.verified_at) as Date | string | null)?.toString() ?? null,
            provenance: (row.offer_provenance as "extracted" | "manually_verified" | null) ?? null,
          },
        }
      : null,
  };
}

export function createApp(getDb: () => Promise<Db>) {
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", async (c) => {
    const db = await getDb();
    const [{ n }] = await db.query<{ n: string | number }>("select count(*) as n from restaurants");
    return c.json({ ok: true, backend: db.backend, restaurants: Number(n) });
  });

  app.get("/api/restaurants", async (c) => {
    const db = await getDb();
    const lat = c.req.query("lat") ? Number(c.req.query("lat")) : null;
    const lng = c.req.query("lng") ? Number(c.req.query("lng")) : null;
    const radiusM = Math.min(Number(c.req.query("radius_m") ?? 800), 5000);
    const district = c.req.query("district") ?? null;
    const hasMenu = c.req.query("has_menu") === "true";
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

    const where: string[] = [];
    const params: unknown[] = [];
    let distanceExpr = "null";

    if (lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      params.push(lat, lng, radiusM);
      // params: $1=lat $2=lng $3=radius. Bounding-box prefilter, then haversine.
      distanceExpr = `
        2 * 6371000 * asin(sqrt(
          power(sin(radians(($1 - r.lat) / 2)), 2) +
          cos(radians($1)) * cos(radians(r.lat)) * power(sin(radians(($2 - r.lon) / 2)), 2)
        ))`;
      where.push(
        `r.lat between $1 - ($3 / 111320.0) and $1 + ($3 / 111320.0)`,
        `r.lon between $2 - ($3 / (111320.0 * cos(radians($1)))) and $2 + ($3 / (111320.0 * cos(radians($1))))`,
        `${distanceExpr} <= $3`
      );
    }
    if (district) {
      params.push(district);
      where.push(`r.district = $${params.length}`);
    }
    if (hasMenu) where.push(`mc.offers_menu is true`);

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    // Menú-first ranking: confirmed menú → confirmed no-menú → not yet classified.
    // Secondary: distance when the query has a location, name otherwise.
    const menuRank = `case when mc.offers_menu is true then 0 when mc.offers_menu is false then 1 else 2 end`;
    const orderSql =
      distanceExpr !== "null"
        ? `order by ${menuRank}, distance_m asc`
        : `order by ${menuRank}, r.name asc`;
    params.push(limit);

    const rows = await db.query<Row & { distance_m: number | null }>(
      `${BASE_SELECT.replace("select r.id", `select ${distanceExpr} as distance_m, r.id`)}
       ${whereSql} ${orderSql} limit $${params.length}`,
      params
    );

    return c.json({
      restaurants: rows.map((r) =>
        toSummary(r, r.distance_m != null ? Math.round(Number(r.distance_m)) : null)
      ),
      total: rows.length,
      attribution: OSM_ATTRIBUTION,
    });
  });

  app.get("/api/restaurants/:id", async (c) => {
    const db = await getDb();
    const rows = await db.query<Row>(`${BASE_SELECT} where r.id = $1`, [c.req.param("id")]);
    if (rows.length === 0) return c.json({ error: "not_found" }, 404);
    const row = rows[0];
    const dishes = row.offer_id
      ? await db.query(
          `select course, name, position from dishes where menu_offer_id = $1 order by position`,
          [row.offer_id]
        )
      : [];
    return c.json({
      ...toSummary(row, null),
      addr_street: row.addr_street ?? null,
      addr_housenumber: row.addr_housenumber ?? null,
      addr_postcode: row.addr_postcode ?? null,
      instagram: row.instagram ?? null,
      phone: row.phone ?? null,
      opening_hours_raw: row.opening_hours_raw ?? null,
      osm_url: `https://www.openstreetmap.org/${row.osm_type}/${row.osm_id}`,
      dishes,
      attribution: OSM_ATTRIBUTION,
    });
  });

  app.get("/api/stats", async (c) => {
    const db = await getDb();
    const [counts] = await db.query<Record<string, number>>(
      `select count(*)::int as restaurants,
              count(*) filter (where website is not null)::int as with_website,
              count(*) filter (where instagram is not null)::int as with_instagram,
              count(*) filter (where opening_hours_raw is not null)::int as with_hours
       from restaurants`
    );
    const byDistrict = await db.query(
      `select district, count(*)::int as n from restaurants group by district order by n desc`
    );
    const classified = await db.query(
      `select coalesce(offers_menu::text, 'unclassified') as label, count(*)::int as n
       from restaurants r left join menu_classifications mc on mc.restaurant_id = r.id
       group by 1`
    );
    return c.json({ counts, by_district: byDistrict, classification: classified });
  });

  return app;
}
