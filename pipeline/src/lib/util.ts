import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

export const CRAWLER_UA =
  "dailymenu-crawler/0.1 (+https://github.com/gpalber/dailymenu; respects robots.txt)";

export function sha256hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

export const gz = (d: Uint8Array | string) =>
  gzipSync(typeof d === "string" ? Buffer.from(d) : d);
export const gunzip = (d: Uint8Array) => gunzipSync(d);

/** "www.foo.com" → "https://www.foo.com"; strips fragments/whitespace; null if hopeless. */
export function normalizeUrl(raw: string | null): string | null {
  if (!raw) return null;
  let u = raw.trim().split(/\s/)[0];
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u.replace(/^\/+/, "");
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes(".")) return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Cheap, dependency-free HTML → text. Snapshots keep the raw HTML; this is versioned code. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&ntilde;/gi, "ñ")
    .replace(/&euro;/gi, "€")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

/** Lowercase + strip diacritics: "Menú del Día" → "menu del dia". */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function extractLinks(html: string, baseUrl: string): { href: string; text: string }[] {
  const out: { href: string; text: string }[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 400) {
    try {
      const href = new URL(m[1], baseUrl).toString();
      out.push({ href, text: htmlToText(m[2]).slice(0, 120) });
    } catch {
      /* unparseable href */
    }
  }
  return out;
}

export async function fetchWithTimeout(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number } = {}
): Promise<{ status: number; contentType: string; body: Uint8Array } | { error: string }> {
  const { timeoutMs = 12000, maxBytes = 2_500_000 } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": CRAWLER_UA, Accept: "text/html,application/pdf;q=0.9,*/*;q=0.5" },
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) return { error: `too_large:${buf.byteLength}` };
    return {
      status: res.status,
      contentType: (res.headers.get("content-type") ?? "").split(";")[0].trim(),
      body: buf,
    };
  } catch (err) {
    return { error: err instanceof Error ? (err.cause as Error | undefined)?.message ?? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
