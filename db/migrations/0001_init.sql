-- 0001_init: provenance-first core schema.
-- Portable Postgres (no extensions): geo queries use bounding box + haversine — ample at this scale.

create table if not exists restaurants (
  id uuid primary key default gen_random_uuid(),
  osm_type text not null check (osm_type in ('node','way','relation')),
  osm_id bigint not null,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  district text not null,
  amenity text not null,
  cuisine text,
  addr_street text,
  addr_housenumber text,
  addr_postcode text,
  website text,
  website_source text check (website_source in ('osm','tripadvisor','brave','manual')),
  instagram text,
  phone text,
  opening_hours_raw text,
  osm_fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (osm_type, osm_id)
);
create index if not exists restaurants_geo_idx on restaurants (lat, lon);
create index if not exists restaurants_district_idx on restaurants (district);

-- One row per restaurant: the latest has-menú classification. History stays in extractions.
create table if not exists menu_classifications (
  restaurant_id uuid primary key references restaurants(id) on delete cascade,
  offers_menu boolean,              -- null = not yet classified / undeterminable
  confidence real,
  extraction_id uuid,               -- fk added after extractions exists
  based_on_snapshot_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists crawl_sources (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  url text not null,
  kind text not null default 'website' check (kind in ('website','menu_page','pdf')),
  discovered_via text not null check (discovered_via in ('osm','tripadvisor','brave','manual')),
  robots_allowed boolean,
  active boolean not null default true,
  last_fetched_at timestamptz,
  last_content_hash text,
  change_frequency_days real,       -- learned; small values promote a source to daily crawl
  created_at timestamptz not null default now(),
  unique (restaurant_id, url)
);

create table if not exists snapshots (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references crawl_sources(id) on delete cascade,
  r2_key text not null,
  content_hash text not null,
  http_status int not null,
  content_type text,
  fetched_at timestamptz not null default now()
);
create index if not exists snapshots_source_idx on snapshots (source_id, fetched_at desc);

create table if not exists extractions (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references snapshots(id) on delete cascade,
  task text not null check (task in ('classify_menu','extract_menu')),
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  output jsonb not null,
  confidence real,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);
alter table menu_classifications
  add constraint menu_classifications_extraction_fk
  foreign key (extraction_id) references extractions(id);

create table if not exists menu_offers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  extraction_id uuid references extractions(id),  -- null for manual entries
  kind text not null check (kind in ('menu_del_dia','menu_ejecutivo','menu_diario','menu_cerrado','other')),
  price_eur numeric(6,2),
  price_notes text,                 -- variants: weekend, terraza, takeaway…
  freshness text not null check (freshness in ('today','recent','typical')),
  as_of_date date,
  is_current boolean not null default true,
  provenance text not null check (provenance in ('extracted','manually_verified')),
  verified_by text,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists menu_offers_current_idx on menu_offers (restaurant_id) where is_current;

create table if not exists dishes (
  id uuid primary key default gen_random_uuid(),
  menu_offer_id uuid not null references menu_offers(id) on delete cascade,
  course text not null check (course in ('primero','segundo','postre','otro')),
  name text not null,
  position int not null default 0
);

-- TripAdvisor terms: location_id is the ONLY attribute that may be stored. Nothing else, ever.
create table if not exists ta_locations (
  restaurant_id uuid primary key references restaurants(id) on delete cascade,
  ta_location_id text not null,
  match_confidence real,
  matched_at timestamptz not null default now()
);

create table if not exists eval_labels (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  task text not null check (task in ('has_menu','price')),
  label jsonb not null,
  labeled_by text not null,
  labeled_at timestamptz not null default now(),
  unique (restaurant_id, task)
);
