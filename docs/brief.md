# Project brief: "Menú del Día" — restaurant daily-menu discovery app (Madrid, v0)

> Original brief as provided by Alberto on 2026-07-27. Kept verbatim for requirements provenance.
> Plan derived from it: [tasks/todo.md](../tasks/todo.md). Decisions taken against §10: recorded in tasks/todo.md §0.

## 1. Problem & value proposition
In Madrid, the *menú del día* (fixed-price weekday lunch: starter + main + dessert/coffee +
drink + bread, typically €12–20) is the dominant lunch format, but the information is
scattered and ephemeral: chalkboards on the street, Instagram stories, PDFs on outdated
websites, or buried inside Google/TripAdvisor review text.

Two gaps I want to close:
1. **Discovery** — which places near me serve one today, at what price, with what dishes.
2. **Quality signal specific to the menu** — a restaurant's overall 4.6★ rating says nothing
   about whether its €14 menú del día is good. I want a score derived *only* from what
   reviewers say about the daily menu, with quoted evidence.

Gap #2 is the differentiator. Prioritise it.

## 2. Primary user & first job-to-be-done
Office worker in central Madrid, 12:30–14:00 on a weekday, walking radius ≤800 m,
budget €10–20. Opens the app and gets: a ranked list of restaurants serving a menú del día,
each with price, today's dishes (if known), a menu-specific quality score, and a link/map.

## 3. v0 scope
**In scope**
- Geography: Madrid city, starting with a dense subset (e.g. Centro / Salamanca / Chamberí),
  target ~300–500 restaurants seeded.
- Detect whether a restaurant offers a menú del día (or similar: menú ejecutivo, menú cerrado,
  menú diario) — with a confidence score, not a boolean guess.
- Extract price (and price variants: weekday vs weekend, dine-in vs takeaway).
- Extract dish composition where obtainable. Distinguish clearly between:
  - `today` — confirmed for today's date
  - `recent` — last seen on a specific date (show the date)
  - `typical` — inferred pattern, no specific date
- Derive a menu-specific sentiment/score from review text, with 2–4 short quoted snippets as
  evidence, each linked to its source.
- Web app: search/browse by location + map, filters (price range, open now, distance,
  cuisine, has-today's-menu), restaurant detail page.
- Spanish-first UI, English as secondary locale from day one.

**Explicitly out of scope for v0**
Bookings, payments, user accounts/auth, user-generated reviews, cities beyond Madrid,
native app store releases, push notifications.

**Non-negotiable data-integrity rule:** never fabricate or "plausibly infer" a dish list or
price. Every displayed fact carries provenance (source + fetch date) and a freshness label.
Missing data is shown as missing.

## 4. Data sourcing — resolve this before writing code
This is the highest-risk part of the project and the part I know least about. Do not assume;
**research current reality and report back**, because the naive answer ("scrape Google Maps")
is against Google's ToS and will get the project killed.

For each candidate source, produce a short assessment: what data it yields, legal/ToS status,
robots.txt stance, rate limits, cost, and reliability. Candidates to evaluate at minimum:
- Google Places API (official, paid, current free-tier limits per SKU — verify today's pricing,
  don't quote from memory)
- OpenStreetMap / Overpass (free restaurant base layer + tags)
- Restaurants' own websites and PDFs
- Restaurants' Instagram / Facebook pages (where daily menus actually get posted)
- TripAdvisor / TheFork(ElTenedor) — check ToS and any partner/affiliate API
- Existing Spanish menú del día aggregators/directories
- Google Business Profile posts

**Constraints on sourcing**
- Respect robots.txt and each site's ToS. If a source is off-limits, say so and route around it.
- Do not store or display reviewer personal data beyond what's necessary; short quoted snippets
  with attribution + link back to source, never wholesale republication of review text.
- Note GDPR implications where relevant.
- Recommend a **primary legal path** and a fallback. If the fully-legal path can't deliver
  dish-level daily menus at zero cost, say that plainly and propose the honest alternative
  (e.g. restaurant-submitted menus, OCR of user-submitted photos, weekly rather than daily
  freshness) rather than quietly degrading the product.

## 5. AI/extraction requirements
- Use an LLM to classify "offers menú del día?", extract price/dishes, and produce the
  menu-specific sentiment summary + evidence quotes. Structured output with a strict schema.
- Cost control is a first-class requirement: batch processing, content hashing so unchanged
  pages are never re-analysed, cheap model for classification and a stronger model only where
  it earns its keep. Give me a per-1000-restaurants cost estimate.
- Every extraction stores: model used, prompt version, source snapshot, confidence.
  I want to be able to re-run extraction on stored raw snapshots without re-crawling.
- Include a way for me to spot-check accuracy (a small labelled eval set + a precision/recall
  number for the "has menú del día" classifier and for price extraction). "It looks right"
  is not acceptance.

## 6. Platform & architecture constraints
- Web first, but **iOS and Android are a near-term certainty** — architect for it now:
  API-first with a typed contract shared between clients, all business logic server-side or in
  a platform-agnostic shared layer, no logic welded to a web-only framework.
- v0 web app should be installable as a PWA (mobile-web is the actual first user experience).
- Recommend the native path (e.g. Expo/React Native vs. native) and justify it, but **do not
  build it in v0** — only avoid decisions that would block it.

## 7. Infrastructure & cost constraints
- Hard cap: **≤ €10/month total until the app generates revenue.** Near-zero preferred.
- **No self-hosting.** No VPS, no home server, no "just run a Docker box". Managed
  platforms and free tiers only.
- Deliver an explicit infra table: service → purpose → free-tier limits → what breaks first
  as usage grows → the first thing I'd have to start paying for and roughly when.
- Scheduled crawling/analysis must fit within free-tier cron/compute limits; call out where it
  won't.
- Prefer boring, well-supported, portable choices over clever ones. Avoid lock-in that would
  be painful to unwind, and flag it where you accept it.
- I have no strong technology preference — choose, and justify in one or two lines per choice.

## 8. Acceptance criteria for v0
1. ≥300 Madrid restaurants in the database with a has-menú-del-día classification.
2. Price present for ≥60% of restaurants classified as offering one.
3. Menu-specific review summary + evidence quotes for ≥70% of them.
4. Every displayed fact shows source and freshness.
5. Deployed at a public URL, usable on a phone browser, loads in ≤3 s on 4G.
6. Running cost measured and under the cap.
7. Classifier accuracy measured on a labelled sample, not asserted.

## 9. What I want from you, in this order
**Step 1 — before any code:** a brief plan summary covering
   (a) the data-sourcing recommendation with the legal reasoning,
   (b) the stack + infra table with costs,
   (c) the phased delivery plan (what ships in week 1 vs later),
   (d) the top 3–5 risks and how each is mitigated or tested early,
   (e) anything in this brief you think is wrong, over-ambitious, or would be better solved
       differently — push back rather than agreeing.
   Write it to `tasks/todo.md` as checkable items and wait for my approval.

**Step 2 — after approval:** implement in vertical slices, each independently verifiable.
Prove each slice works (real data, real output) before moving on. Never mark a task complete
without demonstrating it.

## 10. Questions to put back to me
If any of the following materially change your plan, ask me before finalising it rather than
guessing: how legally conservative I want to be on scraping; whether daily-level freshness is
worth a much harder build than weekly-level; whether I'd accept manual/restaurant-submitted
data seeding for v0; expected launch timeline; whether I want an eventual affiliate/booking
revenue model to shape source choices now.
