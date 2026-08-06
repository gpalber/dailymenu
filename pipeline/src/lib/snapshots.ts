// Snapshot storage: Cloudflare R2 via REST API when available, local .data/snapshots otherwise.
// Same keys either way, so a later copy local→R2 is a plain object upload.
import { loadEnv, repoRoot } from "@dailymenu/db";

export interface SnapshotStore {
  location: "r2" | "local";
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

const clean = (v?: string) => v?.replace(/\s*#.*$/, "").trim() || undefined;

export async function createSnapshotStore(): Promise<SnapshotStore> {
  await loadEnv();
  const token = clean(process.env.CLOUDFLARE_API_TOKEN);
  const account = clean(process.env.CLOUDFLARE_ACCOUNT_ID);
  const bucket = clean(process.env.R2_BUCKET) ?? "dailymenu-snapshots";

  if (token && account) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${account}/r2/buckets`;
    const auth = { Authorization: `Bearer ${token}` };
    // Probe the bucket; create it if R2 is enabled but the bucket doesn't exist yet.
    let ready = false;
    const probe = await fetch(`${base}/${bucket}`, { headers: auth });
    if (probe.ok) ready = true;
    else if (probe.status === 404) {
      const create = await fetch(base, {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ name: bucket }),
      });
      ready = create.ok;
    }
    if (ready) {
      return {
        location: "r2",
        async put(key, data, contentType) {
          const res = await fetch(`${base}/${bucket}/objects/${encodeURIComponent(key)}`, {
            method: "PUT",
            headers: { ...auth, "Content-Type": contentType },
            body: data as BodyInit,
          });
          if (!res.ok) throw new Error(`R2 put ${key}: HTTP ${res.status}`);
        },
        async get(key) {
          const res = await fetch(`${base}/${bucket}/objects/${encodeURIComponent(key)}`, {
            headers: auth,
          });
          if (res.status === 404) return null;
          if (!res.ok) throw new Error(`R2 get ${key}: HTTP ${res.status}`);
          return new Uint8Array(await res.arrayBuffer());
        },
      };
    }
    console.warn("R2 not available (not enabled yet?) — falling back to local snapshot store");
  }

  const { mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const root = join(await repoRoot(), ".data/snapshots");
  return {
    location: "local",
    async put(key, data) {
      const file = join(root, key);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
    },
    async get(key) {
      const file = join(root, key);
      return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    },
  };
}
