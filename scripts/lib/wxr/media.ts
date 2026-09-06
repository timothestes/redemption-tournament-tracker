import { readFileSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { BlobNotFoundError, head, put } from "@vercel/blob";
import { blobPathname, mirrorUrl } from "./urls";

const TYPES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime",
  pdf: "application/pdf", txt: "text/plain", dek: "text/plain", csv: "text/csv", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  htm: "text/html", html: "text/html",
};
export function contentTypeFor(pathname: string): string {
  const ext = pathname.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export interface ManifestEntry { pathname: string; url: string; bytes: number; status: "planned" | "exists" | "uploaded" | "missing" }
export type Manifest = Record<string, ManifestEntry>;

/** Resolves the local backup file for a site path. Throws if the path (after decoding) escapes `backupDir`. */
export function localPath(backupDir: string, sitePath: string): string {
  const base = resolve(backupDir);
  const full = resolve(join(backupDir, decodeURIComponent(sitePath)));
  if (full !== base && !full.startsWith(base + sep)) throw new Error(`path escapes backup dir: ${sitePath}`);
  return full;
}

/** blobPathname decodes the site path; a malformed `%` sequence must not abort the whole plan. */
function safeBlobPathname(sitePath: string): string {
  try { return blobPathname(sitePath); } catch { return `wp${sitePath}`; }
}

export function planMedia(sitePaths: string[], backupDir: string, blobBase: string): Manifest {
  const m: Manifest = {};
  for (const p of sitePaths) {
    const pathname = safeBlobPathname(p);
    let bytes = 0, status: ManifestEntry["status"] = "missing";
    try {
      const st = statSync(localPath(backupDir, p));
      if (st.isFile()) { bytes = st.size; status = "planned"; }
    } catch { /* missing, malformed, or outside backupDir */ }
    m[p] = { pathname, url: mirrorUrl(blobBase, pathname), bytes, status };
  }
  return m;
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3, retryable: (e: unknown) => boolean = () => true): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      if (i === tries - 1 || !retryable(e)) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
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
        try {
          // Look up by pathname (not the locally-computed URL) so idempotency doesn't depend on our
          // URL construction matching Vercel's own encoding for the store.
          const result = await withRetry(() => head(entry.pathname), 3, (e) => !(e instanceof BlobNotFoundError));
          entry.status = "exists"; entry.url = result.url;
        } catch (e) {
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
  const workers = Math.max(1, opts.concurrency);
  await Promise.all(Array.from({ length: workers }, worker));
  opts.log(`media ${done}/${total}`);
}
