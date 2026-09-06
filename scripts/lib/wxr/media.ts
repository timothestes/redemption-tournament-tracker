import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { blobPathname, mirrorUrl } from "./urls";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
  mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", pdf: "application/pdf", txt: "text/plain", dek: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", htm: "text/html", html: "text/html",
};
export function contentTypeFor(pathname: string): string {
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export interface ManifestEntry { pathname: string; url: string; bytes: number; status: "planned" | "exists" | "uploaded" | "missing" }
export type Manifest = Record<string, ManifestEntry>;

export const localPath = (backupDir: string, sitePath: string) => join(backupDir, decodeURIComponent(sitePath));

export function planMedia(sitePaths: string[], backupDir: string, blobBase: string): Manifest {
  const m: Manifest = {};
  for (const p of sitePaths) {
    const pathname = blobPathname(p);
    let bytes = 0, status: ManifestEntry["status"] = "missing";
    try { const st = statSync(localPath(backupDir, p)); if (st.isFile()) { bytes = st.size; status = "planned"; } } catch { /* missing */ }
    m[p] = { pathname, url: mirrorUrl(blobBase, pathname), bytes, status };
  }
  return m;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) { last = e; await new Promise((r) => setTimeout(r, 500 * 2 ** i)); }
  }
  throw last;
}

/** Upload every `planned` entry that is not already in the store. Mutates the manifest. */
export async function mirrorMedia(manifest: Manifest, opts: { backupDir: string; concurrency: number; log: (s: string) => void }): Promise<void> {
  const queue = Object.entries(manifest).filter(([, e]) => e.status === "planned");
  const total = queue.length;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [sitePath, entry] = next;
      try {
        try { await head(entry.url); entry.status = "exists"; }
        catch (e) {
          if (!(e instanceof BlobNotFoundError)) throw e;
          const body = readFileSync(localPath(opts.backupDir, sitePath));
          const res = await withRetry(() => put(entry.pathname, body, { access: "public", addRandomSuffix: false, contentType: contentTypeFor(entry.pathname), cacheControlMaxAge: 31536000 }));
          entry.url = res.url; entry.status = "uploaded";
        }
      } catch (e) {
        opts.log(`media FAILED ${sitePath}: ${(e as Error).message}`);
      }
      if (++done % 100 === 0) opts.log(`media ${done}/${total}`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
}
