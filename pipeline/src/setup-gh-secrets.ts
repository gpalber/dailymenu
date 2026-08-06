// Seal .env values into GitHub Actions repo secrets (libsodium sealed box, per GitHub API).
// Run once, and again after rotating any credential: pnpm exec tsx pipeline/src/setup-gh-secrets.ts
import { loadEnv } from "@dailymenu/db";
import sodium from "libsodium-wrappers";

await loadEnv();
const clean = (v?: string) => v?.replace(/\s*#.*$/, "").trim() || undefined;
const repo = clean(process.env.GITHUB_REPO);
const token = clean(process.env.GITHUB_TOKEN);
if (!repo || !token) { console.error("GITHUB_REPO / GITHUB_TOKEN missing in .env"); process.exit(1); }

const SECRETS = ["DATABASE_URL", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;
const gh = (path: string, init?: RequestInit) =>
  fetch(`https://api.github.com/repos/${repo}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers ?? {}),
    },
  });

const keyRes = await gh("/actions/secrets/public-key");
if (!keyRes.ok) { console.error(`public-key: HTTP ${keyRes.status}`); process.exit(1); }
const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };
await sodium.ready;

for (const name of SECRETS) {
  const value = clean(process.env[name]);
  if (!value) { console.warn(`skip ${name} (empty in .env)`); continue; }
  const sealed = sodium.crypto_box_seal(sodium.from_string(value), sodium.from_base64(key, sodium.base64_variants.ORIGINAL));
  const res = await gh(`/actions/secrets/${name}`, {
    method: "PUT",
    body: JSON.stringify({ encrypted_value: sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL), key_id }),
  });
  console.log(`${name}: ${res.status === 201 ? "created" : res.status === 204 ? "updated" : `HTTP ${res.status}`}`);
}
