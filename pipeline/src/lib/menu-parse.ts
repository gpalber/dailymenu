// heuristic-v2: parse a menú-del-día BLOCK out of page/PDF text.
//
// Design rule (data integrity): dishes are only ever taken from lines that sit under a
// recognised course heading INSIDE the menú block. Nothing is inferred, completed or
// guessed — if the page doesn't say it, we don't store it.
import { foldText } from "./util.js";

export type Course = "primero" | "segundo" | "postre" | "otro";
export interface ParsedMenu {
  offers: boolean | null;
  kind: "menu_del_dia" | "menu_ejecutivo" | "menu_diario" | "menu_cerrado" | "other" | null;
  price_eur: number | null;
  price_candidates: number[];
  price_notes: string | null;
  includes_text: string | null;
  dishes: { course: Course; name: string }[];
  confidence: number | null;
  reason: string;
}

const MENU_PHRASES: { re: RegExp; kind: ParsedMenu["kind"] }[] = [
  { re: /men[uú]\s+del\s+d[ií]a/i, kind: "menu_del_dia" },
  { re: /men[uú]\s+de\s+mediod[ií]a/i, kind: "menu_del_dia" },
  { re: /men[uú]\s+diario/i, kind: "menu_diario" },
  { re: /men[uú]\s+ejecutivo/i, kind: "menu_ejecutivo" },
  { re: /men[uú]\s+cerrado/i, kind: "menu_cerrado" },
];
const NEGATION_RE = /\b(no|sin)\s+(hay\s+|tenemos\s+|servimos\s+|disponemos\s+de\s+)?$/i;

// Headings are matched by PREFIX on a short line, because real menus write things like
// "De Primero 4 Platos distintos a elegir, dependiendo del día de la semana".
const COURSE_HEADINGS: { re: RegExp; course: Course }[] = [
  { re: /^(de\s+)?(primer[oa]s?|entrantes?|para\s+empezar|1[ºo]\s*plato)\b/i, course: "primero" },
  { re: /^(de\s+)?(segund[oa]s?|platos?\s+principal(es)?|principales?|2[ºo]\s*plato)\b/i, course: "segundo" },
  { re: /^(de\s+)?postres?\b/i, course: "postre" },
];
const HEADING_MAX_LEN = 90;

const NON_DISH_RE =
  /^(inicio|carta|men[uú]|reservar?|reservas?|contacto?|tel[eé]fono|horario|cookies?|pol[ií]tica|aviso|legal|siguiente|anterior|ver\s+m[aá]s|descargar|inicio|home|blog|galer[ií]a|eventos?|grupos?|bebidas?|vinos?|precio|iva|alerg|www\.|http|incluye|ejemplo|la\s+casa|consultar|disponible|servicio|todos\s+los|el\s+precio|opci[oó]n|nuestr[oa]s?\b|plato\s+principal)/i;

/** Another "Menú X" heading means we've walked out of this menu and into the next one.
 *  NB: `\b` after "ú" never matches — JS word boundaries are ASCII-only — so match
 *  whitespace/end explicitly instead. */
const NEXT_MENU_RE = /^men[uú]s?(\s|$)/i;

/** The à-la-carte section starting: everything after this belongs to the carta, not the menú.
 *  (Spitiko: "Menú del Día … 14,50€ … Aquí tienes nuestra carta completa" → Entrantes …) */
const CARTA_BREAK_RE = /^(aqu[ií]\s+tienes\s+)?(nuestra\s+)?carta(\s+completa)?\b|^platos?\s+exclu/i;
const PRICE_RE = /(\d{1,2})[.,](\d{2})\s*(?:€|eur\b)|(\d{1,2})\s*€/gi;
const PRICE_MIN = 6;
const PRICE_MAX = 40;
const BLOCK_CHARS = 3000;
const MAX_DISHES_PER_COURSE = 14;

const PROSE_LINE_LEN = 160;

/** Prices, ignoring long prose lines — review/SEO pages say things like "en ese rango de
 *  30-40 €", which is commentary about price, not a menu price. */
function pricesIn(text: string): number[] {
  const out: number[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length > PROSE_LINE_LEN) continue;
    PRICE_RE.lastIndex = 0;
    let m;
    while ((m = PRICE_RE.exec(line))) {
      const val = m[1] ? Number(`${m[1]}.${m[2]}`) : Number(m[3]);
      if (val >= PRICE_MIN && val <= PRICE_MAX) out.push(val);
    }
  }
  return out;
}

/** Tidy a dish line without changing its meaning: trim bullets, trailing dots, whitespace. */
function cleanDish(line: string): string {
  let s = line.replace(/^[-–—*·•.\s]+/, "").replace(/\s+/g, " ").trim();
  s = s.replace(/[.\s]+$/, "");
  // ALL CAPS is common in PDFs — make it readable without altering the words.
  if (s.length > 3 && s === s.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s))
    s = s.toLowerCase().replace(/(^|\s|\()([a-záéíóúñ])/g, (_, p, c) => p + c.toUpperCase());
  return s;
}

function looksLikeDish(line: string): boolean {
  // Test the de-bulleted form: real menus write "-. Caldo Gallego" and "* Incluye pan…",
  // so the leading punctuation must go before the non-dish check can work.
  const s = line.replace(/^[-–—*·•.\s]+/, "").trim();
  if (s.length < 4 || s.length > 90) return false;
  if (/€/.test(s)) return false;
  if (NON_DISH_RE.test(s)) return false;
  if (/[:]$/.test(s)) return false;
  if (/^\d/.test(s)) return false; // "1 Botella de Ribeiro cada 2 personas" — a rule, not a dish
  // Dish names are capitalised on Spanish menus; a lowercase opener is almost always a
  // continuation/description line ("crema de yogurt griego, pepino, ajo, eneldo").
  if (!/^[A-ZÁÉÍÓÚÑÜ0-9"«]/.test(s)) return false;
  // Article/FAQ headings on SEO pages ("¿Cómo son los precios de X?", "Cómo es la comida en X")
  if (/[?¿]/.test(s) || /^(c[oó]mo|qu[eé]|cu[aá]l|d[oó]nde|por\s+qu[eé])\b/i.test(s)) return false;
  const letters = (s.match(/[a-záéíóúñü]/gi) ?? []).length;
  return letters >= 4 && letters / s.length > 0.5;
}

export function parseMenu(text: string): ParsedMenu {
  const none = (reason: string, offers: boolean | null = false, confidence: number | null = 0.6): ParsedMenu => ({
    offers, kind: null, price_eur: null, price_candidates: [], price_notes: null,
    includes_text: null, dishes: [], confidence, reason,
  });

  if (text.trim().length < 200) return none("empty_or_js", null, null);

  // Collect every non-negated menú mention. A page often mentions the menú several times
  // (nav summary, price table, then the real section); we parse each and keep the richest,
  // so a bare nav link never wins over the block that actually lists dishes.
  const hits: { index: number; kind: ParsedMenu["kind"] }[] = [];
  for (const { re, kind } of MENU_PHRASES) {
    const global = new RegExp(re.source, "gi");
    let m;
    while ((m = global.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 25), m.index);
      if (NEGATION_RE.test(before.trim())) continue;
      hits.push({ index: m.index, kind });
      if (hits.length > 40) break;
    }
  }
  if (hits.length === 0) return none("no_menu_phrase");
  hits.sort((a, b) => a.index - b.index);

  let best: ParsedMenu | null = null;
  for (const hit of hits) {
    const candidate = parseAt(text, hit);
    const score = candidate.dishes.length * 5 + (candidate.price_eur != null ? 10 : 0);
    const bestScore = best ? best.dishes.length * 5 + (best.price_eur != null ? 10 : 0) : -1;
    if (score > bestScore) best = candidate;
  }
  return best!;
}

function parseAt(text: string, hit: { index: number; kind: ParsedMenu["kind"] }): ParsedMenu {

  let block = text.slice(hit.index, hit.index + BLOCK_CHARS);
  // Truncate at the next "Menú …" heading so we don't absorb a neighbouring menu's dishes
  // (e.g. Río Miño lists Menú del Día, then Menú Raciones, then Menú Especial I/II/III).
  // Ignore next-menu headings in the first few lines: a menú often states its variants
  // back to back ("Menú del Día 13€ Lunes-Viernes" / "Menú del Día 17€ Sábados"), and
  // those belong to the same offer.
  const rawLines = block.split("\n");
  const MIN_TRUNCATE_LINE = 3;
  const nextMenuAt = rawLines.findIndex(
    (l, i) => i >= MIN_TRUNCATE_LINE && NEXT_MENU_RE.test(l.trim()) && l.trim().length < 60
  );
  if (nextMenuAt > 0) block = rawLines.slice(0, nextMenuAt).join("\n");
  const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);

  // Price: prefer candidates close to the phrase (first ~400 chars of the block).
  // The headline price is the one written closest to the menú heading ("MENÚ DEL DÍA …
  // PVP 15,60€" then "MEDIO MENU … 12,40€"). Take it only when it sits tight to the
  // heading; otherwise leave price null and report the candidates instead of guessing.
  const nearPrices = pricesIn(block.slice(0, 250));
  const allPrices = pricesIn(block);
  const unique = [...new Set(allPrices)];
  const price = nearPrices.length > 0 ? nearPrices[0] : unique.length === 1 ? unique[0] : null;
  const others = unique.filter((p) => p !== price);
  const priceNotes =
    price != null && others.length
      ? `Otros precios en la misma página: ${others.map((p) => `${p.toFixed(2).replace(".", ",")} €`).join(" · ")}`
      : price == null && unique.length > 1
        ? `Precios detectados en su web: ${unique.map((p) => `${p.toFixed(2).replace(".", ",")} €`).join(" · ")}`
        : null;

  // Dishes: walk lines, tracking the current course heading.
  const dishes: { course: Course; name: string }[] = [];
  const perCourse: Record<string, number> = {};
  let current: Course | null = null;
  for (const rawLine of lines) {
    // Section markers are often bulleted ("* Platos Excluidos"), so test the de-bulleted form.
    const line = rawLine.replace(/^[-–—*·•.\s]+/, "").trim();
    if (!line) continue;
    // A new "Menú …" heading means the next menu has started — stop, don't absorb its dishes.
    if (dishes.length > 0 && NEXT_MENU_RE.test(line) && line.length < 60 && !/del\s+d[ií]a/i.test(line)) break;
    if (CARTA_BREAK_RE.test(line) && line.length < 60) break;
    const heading = line.length <= HEADING_MAX_LEN ? COURSE_HEADINGS.find((h) => h.re.test(line)) : undefined;
    if (heading) { current = heading.course; continue; }
    if (!current) continue;
    if (!looksLikeDish(line)) continue;
    const name = cleanDish(line);
    if (!name) continue;
    perCourse[current] = (perCourse[current] ?? 0) + 1;
    if (perCourse[current] > MAX_DISHES_PER_COURSE) continue;
    if (!dishes.some((d) => d.course === current && d.name.toLowerCase() === name.toLowerCase()))
      dishes.push({ course: current, name });
  }

  // "Includes": a line mentioning at least two of the standard inclusions.
  const includes =
    lines.find((l) => {
      const f = foldText(l);
      const hits = ["pan", "bebida", "postre", "cafe", "vino", "agua"].filter((w) => new RegExp(`\\b${w}`).test(f)).length;
      return hits >= 2 && l.length <= 200;
    }) ?? null;

  const hasDishes = dishes.length >= 2;
  const confidence = hasDishes && price != null ? 0.95 : hasDishes ? 0.9 : price != null ? 0.85 : 0.7;

  return {
    offers: true,
    kind: hit.kind,
    price_eur: price,
    price_candidates: unique,
    price_notes: priceNotes,
    includes_text: includes ? includes.replace(/\s+/g, " ").trim() : null,
    dishes,
    confidence,
    reason: hasDishes ? "menu_block_with_dishes" : price != null ? "menu_block_with_price" : "menu_mention_only",
  };
}
