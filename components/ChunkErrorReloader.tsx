"use client";

import { useEffect } from "react";
import { isChunkLoadError } from "@/lib/chunkReload";

// One-time recovery for stale-build chunk failures.
//
// When a client running an older build fails to load a code-split chunk (see
// isChunkLoadError), the current navigation is already broken, so reload once to
// pull the current build. The timestamp guard prevents a reload loop if the
// failure persists (e.g. the origin is genuinely unreachable) while still
// allowing recovery from a separate incident later in the same session.
const RELOAD_KEY = "chunk-reload-at";
const RELOAD_COOLDOWN_MS = 10_000;

function recover(err: unknown) {
  if (!isChunkLoadError(err)) return;

  let last = 0;
  try {
    last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    // sessionStorage can throw in private mode / sandboxed iframes; if we can't
    // read the guard, fall through and reload once (last stays 0).
  }
  if (Date.now() - last < RELOAD_COOLDOWN_MS) return;

  try {
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Best-effort guard; a reload without it is still preferable to a broken page.
  }
  window.location.reload();
}

export default function ChunkErrorReloader() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => recover(e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => recover(e.reason);

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
