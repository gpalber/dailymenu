# Menú del Día — v0 plan (Step 1 deliverable)

**Status: AWAITING APPROVAL.** No implementation starts until Alberto approves this plan.
Full source-by-source legal assessment: [docs/data-sources.md](../docs/data-sources.md). Original brief: [docs/brief.md](../docs/brief.md).

## 0. Decisions locked (Alberto's answers, 2026-07-27)

- [x] **Legal posture: Moderate.** Official APIs (TripAdvisor Content API, OSM/Overpass) + own-site crawling with robots/TDM compliance as the core; SERP-API discovery allowed; no platform scraping. If coverage disappoints, escalations get re-discussed case-by-case ("we'll be creative" = comes back as a concrete proposal with risk assessment, not silent scope creep).
- [x] **Quality signal: live TripAdvisor quotes.** Attributed verbatim review quotes fetched at render time (never stored; only `location_id` persisted, as their terms allow), menú-mentions highlighted. Ranking uses only owned data. Stored review-derived score deferred beyond v0.
- [x] **Freshness: weekly-first.** Honest `today`/`recent`/`typical` labels; sources detected as changing daily get promoted to daily crawl automatically.
- [x] **Seeding: hybrid.** Automated pipeline first; manual spot-fills allowed with `manually_verified` provenance + date. No restaurant-facing forms in v0.

## A. Data sourcing — recommendation

**Primary path:** OSM/Overpass seeds the restaurant base (Centro + Salamanca + Chamberí). Each restaurant's **own website/PDF** is the menu-data source, crawled politely (robots-honoring, rate-limited, identified user-agent) under the EU TDM exception, with raw snapshots archived so extraction can be re-run without re-crawling. **TripAdvisor Content API** (free 5K calls/mo) provides name/website enrichment and the live review-evidence panel. Website discovery order: OSM `website` tag → TA location details → Brave Search API (one-off ~$5 credit).

**Fallback if coverage is poor** (measured in Slice 1, reported honestly): expand manual spot-fills; propose Google-only display stack (the sole compliant way to use Places data) as a separate decision; restaurant opt-in channel post-v0.

**Explicitly rejected:** Google Places storage/derived scores (terms), Instagram ingestion (closed API), scraping Google/TripAdvisor/TheFork/aggregators (ToS + EU database right), press-snippet quoting (Spanish LPI). Reasoning in docs/data-sources.md.

## B. Stack & infra

One-or-two-line justification each; all choices are boring, portable, and free-tier:

- **API: Hono + zod-openapi on Cloudflare Workers.** Free tier allows commercial use (Vercel Hobby doesn't); Hono runs unchanged on Node/Deno/Bun if we ever leave; zod schemas → OpenAPI → typed clients for web now, native later. This is the API-first contract the brief requires.
- **Web: Vite + React SPA (served as Workers static assets), MapLibre GL + OpenFreeMap tiles, i18next (ES default/EN), vite-plugin-pwa.** No framework-welded logic; map lazy-loaded to protect the 3s/4G budget; OpenFreeMap is keyless/free (fallback: MapTiler free 100K loads/mo).
- **DB: Supabase Postgres (+PostGIS).** Plain portable Postgres; 500MB is ample because raw snapshots live in R2, not the DB. Free-tier pause-after-7-idle-days is neutralized by the weekly pipeline writes + a keep-alive ping. (Documented alternative: Cloudflare D1, 5GB free, no pausing — but SQLite + CF-coupled access.)
- **Snapshots: Cloudflare R2.** 10GB free, zero egress fees; stores compressed page snapshots + content hashes.
- **Pipeline: plain TypeScript/Node in GitHub Actions cron.** Public repo = free runner minutes; crawler needs none of the Workers limits (10ms CPU, 50 subrequests). Cron-delay/60-day-disable quirks mitigated by a Cloudflare Cron Trigger firing `workflow_dispatch`.
- **LLM: Anthropic Batch API.** `claude-haiku-4-5` ($1/$5 per MTok, −50% batch) for classify+extract in one structured call; escalate low-confidence (<0.7) to `claude-sonnet-5` (intro $2/$10 through 2026-08). Every extraction row stores model, prompt_version, schema_version, snapshot ref, confidence, token counts — re-runnable from stored snapshots without re-crawling.
- **Monorepo (pnpm):** `apps/web`, `apps/api`, `packages/schema` (zod + generated client), `pipeline/` (seed, crawl, extract, eval), `.github/workflows/`.
- **Native path (recommended, NOT built):** Expo/React Native, reusing `packages/schema` + the typed API client; OpenAPI keeps Swift/Kotlin open. v0 avoids blockers: zero web-only coupling, all logic behind the API.

### Infra table

| Service | Purpose | Free tier | What breaks first as usage grows | First € |
|---|---|---|---|---|
| Cloudflare Workers | API + web hosting | 100K req/day, 10ms CPU | Request volume at ~thousands of DAU | $5/mo Workers Paid |
| Supabase | Postgres + PostGIS | 500MB DB, 5GB egress, pauses after 7 idle days | DB size only if snapshots leaked into it (they won't); pause if pipeline stops | $25/mo Pro (far off) |
| Cloudflare R2 | Raw snapshots | 10GB, 1M writes/mo | Years away at ~30MB/week compressed | ~$0.015/GB/mo |
| GitHub Actions | Crawl/extract cron | Public repo: free standard runners | Only if repo goes private (2,000 min/mo) | $0 |
| Anthropic API | Extraction | none — pay per token | Linear with restaurant count × change rate | **~€6 one-off backfill; ~€1–2/mo steady** |
| TripAdvisor Content API | Live quotes + enrichment | 5,000 calls/mo, daily budget cap | Detail-page views ≈160/day with quotes; guard degrades gracefully | pay-as-you-go past 5K |
| Brave Search API | Website discovery | $5 prepaid ≈1,000–1,666 queries | One-off use only | that $5 |
| OpenFreeMap | Map tiles | Free, keyless | Reliability (donation-run) → swap to MapTiler free | $0 |
| Domain | Optional in v0 | `*.workers.dev` free | Vanity | ~€10/yr |

**Cost math (per 1,000 restaurants, full pass, Batch API):** ~12K tokens in + ~500 out per restaurant on Haiku ≈ **$7.3**; ~15% escalated to Sonnet ≈ **$3.5**; total ≈ **$11/1,000** (~€5–6 for the 500-restaurant backfill). Weekly re-runs are hash-gated to changed pages (~20–30%) ≈ **€1–2/month steady state. Total running cost ≈ €1–3/month — under the €10 cap**, with a bursty first month (~€8–11 incl. Brave credit) flagged in §E.

## C. Phased delivery (vertical slices, each with a verify gate)

### Slice 0 — Foundations + seed (days 1–2)
- [x] `git init`, pnpm monorepo scaffold, schema v1 with provenance built in (2026-07-27). Dev DB = embedded PGlite (Docker daemon unavailable in sandbox); prod = Supabase, same migrations. Supabase project itself: pending credentials.
- [x] Overpass seed for Centro/Salamanca/Chamberí (2026-07-27): **3,591 named venues** (Centro 2,272 / Chamberí 739 / Salamanca 580; 2,337 restaurants, 717 bars, 537 cafés). Coverage signals: website 35% (1,259), instagram 2%, opening_hours 16%. OSM attribution in UI ✓
- [x] Skeleton API + bare list UI **verified locally** (2026-07-27): /health, radius query (Puerta del Sol 400 m → 3 venues at 51/68/71 m), /api/stats, district filters. Public workers.dev deploy: **pending Cloudflare + Supabase credentials**
- [x] **Verify (2026-08-07): SLICE 0 GATE PASSED.** Public URL live: **https://dailymenu.dailymenu-api.workers.dev** — /health serves 3,591 restaurants from Supabase (`backend: postgres`), radius query verified (La Bohemia, 21 m from Glorieta de Bilbao), web UI served from Worker assets, repo pushed to github.com/gpalber/dailymenu (public).
- [ ] One-click leftover: **enable R2 in the Cloudflare dashboard** (account-level toggle, free tier; API token can't do it — error 10042). Needed before Slice 1 snapshots.

### Measured running cost (2026-08-07) — criterion 6 evidence
Measured, not estimated. Total: **€0.00/month.** Nothing on the account can bill at current usage.

| Service | Measured usage | Free limit | % used | First thing that would bill |
|---|---|---|---|---|
| Cloudflare R2 | ~46 MB, 1,336 objects | 10 GB, 1M writes/mo | ~0.5% | ~16 years of weekly crawls at current growth (~50 MB/mo, hash-gated) |
| Supabase Postgres | 13 MB | 500 MB | 2.6% | ~5 years (extraction rows dominate; prunable — R2 snapshots are source of truth) |
| Cloudflare Workers | tens of req/day | 100,000 req/day | <0.1% | ~100k daily requests ≈ thousands of real users |
| GitHub Actions | ~10 min/week | unlimited (public repo) | — | only if repo went private |
| LLM | €0 (heuristic-v1) | — | — | only if we opt into the Anthropic API later |

Watch-outs (reliability, not cost): Supabase free tier pauses after 7 idle days — the weekly cron's writes prevent this, so a silently failing cron is the real risk; R2 requires a payment method on file, so a runaway loop is the only realistic billing path (crawler is rate-limited and hash-gated).

### Plan amendments (2026-08-07, agreed with Alberto)
- **€0 LLM strategy for v0:** no Anthropic API key. Extraction = deterministic heuristic first (`model: heuristic-v1` — keyword + price-regex, measured against the eval set), ambiguous residue done by Claude in working sessions (`model: claude-session`). API remains a documented flip-of-a-switch (~€2–5/mo) for hands-off weekly freshness later. Subscription is never wired into CI.
- **Scope reconfirmed:** current three districts (measured alternatives: Madrid city 7,425 venues ≈ €28 one-off + €5–10/mo; Comunidad 11,560 ≈ €45 + €8–15/mo tiered — deferred post-v0).
- **TripAdvisor:** legacy Content API sunsets 2026-08-31; Terra API pricing unverifiable pre-signup (only "first 1,000 calls free" advertised). Slice 4 decision pending: defer quotes panel + ship review link-outs (recommended) vs. sign up regardless.

### Slice 1 — Crawl + classify + eval (week 1)
- [x] Website discovery (2026-08-07): OSM tags only for now (1,259 sites, 35%). TA deferred; Brave key not provided (optional) — the 65% without sites stay `unknown` until then. Discovery provenance stored per source.
- [x] Robots-honoring crawler (2026-08-07): 1,121 hosts in 9.6 min — **1,321 snapshots to R2** (homepages + 447 discovered menu pages + 113 PDFs), 23 robots-blocks honored, content-hash gating live, weekly GitHub Actions cron + sealed secrets. Dead-link reality: 324 fetch errors + 155 HTTP errors (~38% of OSM website tags are stale).
- [x] Classifier (2026-08-07, amended to €0 path): `heuristic-v1` over 811 crawlable restaurants → **84 offers detected (13 with price), 616 no-mention, 111 residue** for in-session review. Results + provenance live on the public site.
- [ ] Eval set: `eval/sample-to-label.csv` generated (100 random crawlable restaurants). Next: Claude labels in-session from snapshots, Alberto spot-checks ~30, then `pnpm eval --import` → precision/recall. Gate: precision ≥0.85.
- [ ] **Verify (remaining):** P/R numbers from the labeled set; residue queue worked through in-session; PDF parsing (Slice 2) expected to convert some "no"→"sí" (113 unparsed PDFs).

### Slice 2 route — measured 2026-08-07, before spending anything

**Triage of the 811 crawled restaurants** (`pnpm exec tsx pipeline/src/triage.ts` → `eval/triage.json`):

| Source shape | Count | Technique needed | Cost |
|---|---|---|---|
| HTML with course structure | 198 | menu-block parser — **but many are à-la-carte cartas, not menús** (verified: Cervecería Santa Ana, Artemisa) | €0 |
| …of those, genuine **menú-del-día block with dishes** | **36** | the complete-record candidates (`eval/complete-candidates.json`) | €0 |
| PDF menus (already stored) | 41 | `pdfjs-dist` text extraction — no re-crawl | €0 |
| JS-rendered / empty | 113 | Playwright re-crawl in Actions (free minutes, public repo) | €0 |
| Image-only menus | 7+ | `tesseract.js` OCR, or in-session vision | €0 |
| Menú mentioned, no structure | 16 | in-session extraction from stored snapshot | €0 |
| No menú signal | 436 | genuinely absent from their site — honest "unknown" | — |

**Three real page shapes found, all handled by the schema:**
- **A — dishes enumerated** (Río Miño): 4 primeros + 4 segundos listed as examples → dishes stored, `freshness=typical`
- **B — choose-from-carta** (Spitiko): no fixed dish list; composition + exclusions stored in `includes_text`
- **C — price variants, dishes dynamic** (Terra Mundi): 3 prices captured in `price_notes`, dishes absent (JS) and shown as missing

**Proven end-to-end 2026-08-07** on those three via `pipeline/src/apply-extraction.ts` (model `claude-session`, every record linked to the snapshot it was read from — a provenance mismatch on Terra Mundi was caught and fixed). Río Miño now shows price 13 €/17 €, what's included, serving days, and 8 dishes live on the site.

**Order of work (all €0, most yield first):** 1. menu-block parser · 2. PDF extraction (41) · 3. Playwright for JS pages (113) · 4. OCR/vision for images · 5. in-session extraction for the remainder. **Only after that** is the €5 Brave discovery worth buying — it finds *more websites*, which is worthless until we read the ones we have properly.

Honest projection: 84 → roughly 150–200 menú-positive restaurants, with dish-level detail for perhaps 60–120. Not the full 3,591: most Madrid bars simply don't publish a menu online, which is a fact about the world, not a fixable pipeline defect.

### Slice 2 — Price + dishes + freshness (week 2)
- [ ] Extraction schema: price + variants (weekday/weekend, terraza, takeaway), courses, freshness (`today`/`recent`+date/`typical`), never-fabricate rule enforced by schema (missing = null)
- [ ] Sonnet escalation for low-confidence extractions; PDF text extraction; image-only menus flagged "menu exists, not machine-readable" (no OCR in v0)
- [ ] Detail page with per-fact provenance chips (source link + fetched date + freshness)
- [ ] Price eval on 50 labeled restaurants; gate: **≥90% price exact-match** on extractable menus
- [ ] **Verify:** ≥60% of menú-positive restaurants show a price (criterion 2), measured on real data

### Slice 3 — Map, filters, PWA, i18n (week 2)
- [ ] MapLibre map (lazy-loaded) + list ranking: menu-confidence × freshness × distance (transparent, no fake quality score)
- [ ] Filters: price range, distance, has-menú, open-now (only where hours known — from OSM or extracted from site; unknown shown honestly)
- [ ] ES/EN locales; PWA installable; performance budget ≤450KB gz initial route
- [ ] **Verify:** Lighthouse mobile (4G throttle) load ≤3s on the public URL; install-to-homescreen works on a phone

### Slice 4 — Review link-outs (week 3) — AMENDED 2026-08-07: TA quotes deferred post-v0
Rationale: legacy Content API sunsets 2026-08-31 (building on it = building twice); Terra pricing not inspectable pre-signup; no like-for-like alternative exists (Google display-stack-locked, Yelp paid+thin in Madrid, TheFork closed). Decision: Alberto, 2026-08-07.
- [ ] Detail-page link-outs (plain URLs, zero API): "Reseñas en TripAdvisor" (search deep-link name+Madrid), "Reseñas en Google Maps" (maps search URL), restaurant Instagram/web where known
- [ ] **Post-v0 ticket:** evaluate Terra API pricing at signup; if it fits the cap, implement the original live-quotes panel (design unchanged: location_id-only storage, live fetch, TA display rules)
- [ ] **Verify:** link-outs resolve to the right venue for a 30-restaurant sample (measure hit-rate)

### Slice 5 — Hardening + measurement (week 3)
- [ ] Weekly cron (CF Cron Trigger → workflow_dispatch): re-crawl hash-gated; per-source change-frequency tracking promotes daily-changing sites to daily crawl
- [ ] Supabase keep-alive; failure alerts (Actions → email)
- [ ] `/stats`: coverage %, freshness distribution, classifier metrics, token spend + € cost log (criterion 6 measured, not guessed)
- [ ] Manual spot-fill path (CLI/SQL template) writing `manually_verified` provenance + date
- [ ] Aviso legal/privacy page; OSM + TA attribution audit
- [ ] **Verify:** full acceptance-criteria checklist (§G) run against production with real numbers

## D. Top risks & mitigations

1. **Web-presence coverage gap** — many menú places are chalkboard-only; % with crawlable menus is *the* unknown. → Measured in Slice 1 week 1 and reported before further build; mitigations: TA/Brave discovery chain, hybrid spot-fills, criteria renegotiation if reality <60%. This is why crawl+classify ships first.
2. **Extraction quality on messy sources** (PDFs, image menus, ambiguous prices). → Labeled eval with hard gates (P≥0.85 classify, ≥90% price match); schema forbids fabrication; image menus honestly flagged; OCR is a phase-2 decision.
3. **TripAdvisor dependency** (match-rate unknown; free quota ceiling; announced "Terra" platform migration). → location match-rate measured; quota guard degrades gracefully; source adapters modular so the evidence panel can be disabled without touching core data; terms re-checked at signup.
4. **Free-tier operational fragility** (Supabase pausing, Actions cron delays/disable, OpenFreeMap SLA). → keep-alive writes, CF-cron-triggered dispatch, public repo, MapTiler fallback wired as config.
5. **Scope/legal drift** — "moderate and creative if needed" can slide into scraping. → Guardrail agreed: any escalation beyond the documented posture comes back as an explicit proposal with risk assessment before code.

## E. Pushback on the brief

1. **Criterion 3 as written is not legally buildable.** Both Google and TripAdvisor prohibit storing reviews or deriving/storing scores from them. Amended (with your agreement) to live attributed quotes + owned-data ranking; the *stored, scored* version needs licensed data or own reviews — a post-v0 track, stated plainly rather than quietly degraded.
2. **"Today's dishes" will be rare in v0** even at maximum effort — Instagram (where dailies live) is closed, and most restaurant sites don't change daily. Weekly-first with honest labels (agreed). Expect the `today` badge on a small minority; the `typical` menu + price is still the useful 80%.
3. **The cap holds monthly (~€1–3) but month 1 is bursty** (~€8–11: LLM backfill + Brave credit). Under €10 if backfill is spread across two batch runs; flagging rather than hiding it.
4. **Competitors exist** (comermenudeldia.com = restaurant-submitted, uneven coverage; Appetece = editorial). Not fatal — validates demand, and neither does automated coverage, provenance honesty, or menu-specific evidence. Differentiation survives in its compliant form.
5. **Minor:** "open now" can only be honest where hours are known (OSM coverage is partial; Google hours aren't storable) — the filter will say "hours unknown" rather than guess, per your own data-integrity rule.

## F. Assumptions (correct me if wrong)

- Timeline: ~3 weeks part-time to acceptance-criteria state; no launch deadline given.
- Revenue: none in v0; TheFork affiliate link-outs are a compatible later add and don't change sourcing now.
- I hand-label the eval set with you spot-checking ~30 of the 100.

## G. Acceptance criteria (amended where forced by law)

| # | Criterion | Status |
|---|---|---|
| 1 | ≥300 Madrid restaurants with has-menú classification | unchanged |
| 2 | Price for ≥60% of menú-positive | unchanged |
| 3 | ~~Stored review summary + quotes~~ → ~~live TA quote panel~~ → **deferred post-v0** (2026-08-07: legacy API sunset + Terra pricing opaque). v0 ships review link-outs; quotes return via Terra if its pricing fits the cap | deferred |
| 4 | Every fact shows source + freshness | unchanged — schema-enforced |
| 5 | Public URL, phone-usable, ≤3s on 4G | unchanged — Lighthouse-measured |
| 6 | Cost measured & under €10/mo | unchanged — /stats cost log |
| 7 | Classifier + price accuracy measured on labeled sample | unchanged — P/R published |

---
**→ Approve this plan (or edit inline) and Step 2 starts at Slice 0.**
