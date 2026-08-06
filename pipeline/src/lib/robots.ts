// Minimal robots.txt support: group matching (our UA, then *), longest-rule-wins
// allow/disallow, crawl-delay. Unreachable/absent robots.txt ⇒ allowed (standard practice).
import { fetchWithTimeout } from "./util.js";

export interface RobotsPolicy {
  isAllowed(path: string): boolean;
  crawlDelayMs: number;
  fetched: boolean;
}

const ALLOW_ALL: RobotsPolicy = { isAllowed: () => true, crawlDelayMs: 1000, fetched: false };
const cache = new Map<string, RobotsPolicy>();

export async function robotsFor(origin: string): Promise<RobotsPolicy> {
  const hit = cache.get(origin);
  if (hit) return hit;
  const res = await fetchWithTimeout(`${origin}/robots.txt`, { timeoutMs: 6000, maxBytes: 200_000 });
  let policy = ALLOW_ALL;
  if (!("error" in res) && res.status === 200 && res.contentType.startsWith("text/")) {
    policy = parse(new TextDecoder("utf-8", { fatal: false }).decode(res.body));
  }
  cache.set(origin, policy);
  return policy;
}

function parse(txt: string): RobotsPolicy {
  type Group = { agents: string[]; rules: { allow: boolean; path: string }[]; delay?: number };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!current) continue;
      if (key === "disallow" || key === "allow") {
        if (value) current.rules.push({ allow: key === "allow", path: value });
        // empty Disallow means "allow everything" — no rule needed
      } else if (key === "crawl-delay") {
        const n = Number(value);
        if (Number.isFinite(n)) current.delay = n;
      }
    }
  }
  const mine =
    groups.find((g) => g.agents.some((a) => a.includes("dailymenu"))) ??
    groups.find((g) => g.agents.includes("*"));
  if (!mine) return { ...ALLOW_ALL, fetched: true };

  const rules = mine.rules;
  const delayMs = Math.min(Math.max((mine.delay ?? 1) * 1000, 1000), 15000);
  return {
    fetched: true,
    crawlDelayMs: delayMs,
    isAllowed(path: string) {
      let best: { allow: boolean; len: number } | null = null;
      for (const r of rules) {
        // support trailing wildcard '*' and '$' anchors loosely
        const p = r.path.replace(/\$$/, "");
        const matches = p.includes("*")
          ? new RegExp("^" + p.split("*").map(escapeRe).join(".*")).test(path)
          : path.startsWith(p);
        if (matches && (!best || p.length > best.len)) best = { allow: r.allow, len: p.length };
      }
      return best ? best.allow : true;
    },
  };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
