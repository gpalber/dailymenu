# Data source assessment — researched 2026-07-27

Every claim below was verified against current pages on 2026-07-27 (not from memory).
Legal posture chosen by Alberto: **Moderate** — official APIs + own-site crawling as the core;
gray-area helpers (SERP APIs) allowed for discovery; no platform scraping. Escalations beyond
this get re-discussed with a specific risk assessment first.

## Verdict table

| Source | Yields | Legal/ToS status | Cost | Verdict |
|---|---|---|---|---|
| **OpenStreetMap / Overpass** | Restaurant base layer: name, geo, address, `cuisine`, `website`, `contact:instagram`, `opening_hours` (partial) | ODbL: attribution required ("© OpenStreetMap contributors" → copyright page); share-alike applies to OSM-derived parts. Public Overpass instances: fair-use rate limiting, fine for weekly bulk queries | €0 | **✅ Primary seed layer** |
| **Restaurants' own websites & PDFs** | Menú presence, price, dishes, hours — the core product data | Legal under EU TDM exception (DSM Directive Art. 4; Spain: RDL 24/2021) for lawfully accessible content **if** machine-readable opt-outs are honored → we respect robots.txt + obvious ToS. Prices/dish lists are facts (thin copyright). Polite crawling (rate-limited, identified UA) | €0 + LLM extraction | **✅ Primary menu-data source** |
| **TripAdvisor Content API (self-serve)** | Location match, details (website, rating), ~5 most recent reviews per location | Official, self-serve (no partner gatekeeping): **5,000 free calls/month**, then pay-as-you-go with a daily budget cap. Caching policy: **only `location_id` storable; all other attributes (incl. reviews) may not be cached, stored, or indexed.** Display rules: TA logo near content, verbatim quotes in quotation marks + "A Tripadvisor traveler review" + review date, their bubble ratings only (never own icons), 5★ quotes only if overall ≥4.0. Note: a "Terra API platform" is announced as coming — re-check terms at signup | €0 within 5K calls/mo | **✅ Review evidence (live display only) + website/name enrichment** |
| **Google Places API** | Details, hours, website, ratings, 5 reviews | Per-SKU free tiers since 2025-03-01 (Essentials 10K, Pro 5K, Enterprise 1K calls/mo). But: **only place IDs storable indefinitely**; no caching/storing anything else; **no derived rankings/ratings**; **Places results shown on a map must be shown on a Google map** — incompatible with our MapLibre/OSM stack unless the whole display stack goes Google | €0 in-tier | **❌ Not in v0.** Documented fallback: if coverage demands it, an all-Google display stack is the only compliant way in |
| **Instagram / Facebook (Meta)** | Where daily menus are actually posted | Basic Display API dead (2024-12). Graph API `business_discovery` exists but requires app review, business verification, and only reaches professional accounts; aggregating third-party business content is unlikely to pass review. Scraping violates ToS | — | **❌ No ingestion in v0.** Link out to profiles (OSM `contact:instagram` + site links). Post-v0 option: restaurant opt-in |
| **Google Business Profile posts** | Daily posts by some restaurants | API only for profiles you own/manage; scraping Maps banned | — | **❌ Off-limits** |
| **TheFork / ElTenedor** | Menus, reviews, bookings | Partners/B2B API is for restaurant-side integrations, not data consumers. Affiliate programs exist (FlexOffers/MyLead, ~20-day cookie) — links out, not data in. Scraping (incl. via Apify actors) violates ToS | — | **❌ As data source. ✅ Later as affiliate link-out revenue** |
| **Existing aggregators** (comermenudeldia.com, Appetece) | Competitor data | Their databases → EU sui generis database right; scraping them is both illegal-ish and strategically pointless | — | **❌ Do not touch. Competitive intel only** (see below) |
| **Press articles / listicles** (Timeout, El País…) | Curated "best menú" lists | Spain has specific press-snippet rules (art. 32.2 LPI — aggregator snippets are a licensed/remunerated activity) | — | **❌ No quoting. Reading them manually to seed the hybrid spot-fill list is fine** |
| **SERP APIs (Brave Search API)** | Website discovery for restaurants lacking OSM/TA website tags | Brave: official API over their own index — clean. Free tier was killed (2026-02): now $5 prepaid credit ≈ 1,000–1,666 queries, then metered (~$3–5/1K). This is the "moderate" gray-zone item only in the sense that other SERP providers resell Google results — **we use Brave (own index), which isn't gray at all** | ~$5 one-off | **✅ Optional discovery fallback** |

## Competitive scan (2026-07)

- **comermenudeldia.com** ("Menú del día cerca de ti", iOS/Android, all Spain): built entirely on **restaurant self-submission**; freemium + paid restaurant promotion. Coverage uneven. No review-derived quality signal.
- **Appetece**: editorial neighborhood guides, manually curated.
- Nobody does automated coverage + menu-specific review evidence + provenance labels. The differentiator holds, in its legally compliant form.

## Legal framework notes

- **Crawling own sites**: EU TDM exception (DSM Art. 4, transposed in Spain by RDL 24/2021) permits reproduction/extraction for text-and-data-mining of lawfully accessible works unless opted out in machine-readable form → the crawler must parse and honor robots.txt and visible crawl prohibitions; keep the raw snapshot as evidence of what was public when.
- **GDPR**: restaurant business data = legitimate interest (Art. 6(1)(f)), it's business contact data. Reviewer personal data: **never stored** — TA reviews are fetched at render time and displayed with TA's own attribution, then discarded. No user accounts, no tracking cookies in v0 (Cloudflare's cookieless analytics) → no consent banner needed. Site needs a basic aviso legal/privacy page.
- **ODbL**: OSM attribution in the map UI and on the about page; our combined DB is a collective database — the OSM-derived portion remains ODbL.
- **Database sui generis right** (Directive 96/9/EC): the reason platform/aggregator scraping is rejected — extracting substantial parts of protected databases creates real liability in the EU, independent of ToS.
- **Provenance rule** (from the brief, non-negotiable): every displayed fact carries source + fetch date + freshness label; missing data is shown as missing. This is implemented in the schema (see plan), not as an afterthought.
