import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, requireThreshingFloor } from "../../auth";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel rejects > 4.5 MB at the edge

// Fixed set of shared keys. This is NOT an open-ended keyspace — only these
// known singletons are allowed so the table stays tidy and predictable.
const ALLOWED_KEYS = new Set(["players", "tournaments", "side-events", "rtn-data"]);

// Append-only keys are sets that only ever grow (e.g. the player registry). For
// these, a write with no concurrency token must NOT clobber a row created
// concurrently — it INSERTs and 409s on conflict so the client reconciles.
// Every other key is a last-write-wins snapshot (e.g. rtn-data = the latest
// episode's recurring Road-to-Nationals details) and may overwrite freely.
const APPEND_ONLY_KEYS = new Set(["players"]);

async function resolveKey(params: Promise<{ key: string }>): Promise<string | null> {
  const { key } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(key);
  } catch {
    return null;
  }
  return ALLOWED_KEYS.has(decoded) ? decoded : null;
}

type Ctx = { params: Promise<{ key: string }> };

// GET /threshingfloor/api/store/{key} -> { key, data, updated_at } | 404
export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const key = await resolveKey(params);
  if (!key) return NextResponse.json({ error: "Unknown store key" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("threshing_floor_store")
    .select("key, data, updated_at")
    .eq("key", key)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to load value" }, { status: 500 });
  if (!data) return notFoundResponse();
  return NextResponse.json(data);
}

// PUT /threshingfloor/api/store/{key} -> { key, updated_at }
// Body: { data: <object|array>, lastSeenUpdatedAt?: string }
export async function PUT(request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const key = await resolveKey(params);
  if (!key) return NextResponse.json({ error: "Unknown store key" }, { status: 400 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Value too large (over 4 MB)" }, { status: 413 });
  }
  let body: { data?: unknown; lastSeenUpdatedAt?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // Accept objects (e.g. players registry) and arrays (e.g. tournament names),
  // but not primitives or null.
  if (typeof body.data !== "object" || body.data === null) {
    return NextResponse.json({ error: "data must be an object or array" }, { status: 400 });
  }

  const row = {
    key,
    data: body.data,
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };

  // Optimistic concurrency. Shared keys (especially the player registry) are
  // edited by multiple hosts across sessions.
  if (typeof body.lastSeenUpdatedAt === "string") {
    // Caller is overwriting a row it has already seen. Reject if its snapshot is
    // stale so a save can't silently clobber a change made elsewhere.
    const { data: existing, error: existingError } = await auth.supabase
      .from("threshing_floor_store")
      .select("updated_at")
      .eq("key", key)
      .maybeSingle();
    if (existingError) {
      return NextResponse.json({ error: "Failed to check value" }, { status: 500 });
    }
    if (existing && body.lastSeenUpdatedAt !== existing.updated_at) {
      return NextResponse.json(
        { error: "Value was modified by someone else" },
        { status: 409 }
      );
    }

    const { data: saved, error } = await auth.supabase
      .from("threshing_floor_store")
      .upsert(row, { onConflict: "key" })
      .select("key, updated_at")
      .single();
    if (error || !saved) {
      return NextResponse.json({ error: "Failed to save value" }, { status: 500 });
    }
    return NextResponse.json(saved);
  }

  // No token. Behavior depends on the key's semantics:
  if (APPEND_ONLY_KEYS.has(key)) {
    // Append-only set: the caller believes the row doesn't exist yet (first
    // write). Use a plain INSERT so a row created concurrently by another host
    // triggers a unique violation -> 409 (reconcile) instead of a silent
    // overwrite. This closes the empty-store clobber window an unconditional
    // upsert would leave open.
    const { data: saved, error } = await auth.supabase
      .from("threshing_floor_store")
      .insert(row)
      .select("key, updated_at")
      .single();
    if (error) {
      if (error.code === "23505") {
        // unique_violation: someone created the row since the caller last looked.
        return NextResponse.json(
          { error: "Value was modified by someone else" },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Failed to save value" }, { status: 500 });
    }
    return NextResponse.json(saved);
  }

  // Last-write-wins snapshot: overwrite freely. The latest write is always the
  // intended state, so a token isn't required.
  const { data: saved, error } = await auth.supabase
    .from("threshing_floor_store")
    .upsert(row, { onConflict: "key" })
    .select("key, updated_at")
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: "Failed to save value" }, { status: 500 });
  }
  return NextResponse.json(saved);
}
