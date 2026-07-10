// Detection for Next.js code-split chunk load failures.
//
// These happen when a client is running an *older* build (a stale tab) and the
// router tries to lazy-load a code-split chunk whose content-hashed filename no
// longer exists on the origin — e.g. after a new deploy, or when a long-lived
// tab outlives Vercel's skew-protection window. Webpack surfaces this as a
// `ChunkLoadError` (usually via an unhandled promise rejection from `import()`),
// with a message of the form "Loading chunk <id> failed" (or "Loading CSS
// chunk <id> failed").
//
// Deliberately narrow: a generic `TypeError: NetworkError when attempting to
// fetch resource` (e.g. a failed RSC payload or API call) is NOT treated as a
// chunk error — Next's router already falls back to a browser navigation for
// those, and reloading on every transient fetch hiccup would be far too eager.
export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const name = (err as { name?: unknown }).name;
  if (name === "ChunkLoadError") return true;
  const message =
    typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message
      : String(err);
  return /ChunkLoadError/.test(message) || /Loading (?:CSS )?chunk .+ failed/i.test(message);
}
