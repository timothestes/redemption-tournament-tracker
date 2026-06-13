import { NextRequest, NextResponse } from "next/server";
import { normalizeEpisode } from "../../../../episodes";
import { notFoundResponse, requireThreshingFloor } from "../../../auth";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // Vercel rejects > 4.5 MB at the edge

async function resolveEpisode(params: Promise<{ episode: string }>): Promise<string | null> {
  const { episode } = await params;
  let decoded: string;
  try {
    decoded = decodeURIComponent(episode);
  } catch {
    return null;
  }
  return normalizeEpisode(decoded);
}

type Ctx = { params: Promise<{ episode: string }> };

function publicUrl(episode: string): string {
  return "/threshingfloor/episodes/" + encodeURIComponent(episode);
}

// POST = save current data AND freeze it as the public snapshot (one step, so
// the published copy is exactly what's on screen).
export async function POST(request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Draft too large (over 4 MB)" }, { status: 413 });
  }
  let body: { data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return NextResponse.json({ error: "data must be an object" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: saved, error } = await auth.supabase
    .from("threshing_floor_drafts")
    .upsert(
      {
        episode_number: episode,
        data: body.data,
        published_data: body.data,
        published_at: now,
        updated_by: auth.user.id,
        updated_at: now,
      },
      { onConflict: "episode_number" }
    )
    .select("episode_number, published_at")
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: "Failed to publish" }, { status: 500 });
  }
  return NextResponse.json({ ...saved, url: publicUrl(episode) });
}

// DELETE = unpublish (take the public page down). Leaves the draft intact.
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const { error } = await auth.supabase
    .from("threshing_floor_drafts")
    .update({ published_data: null, published_at: null })
    .eq("episode_number", episode);
  if (error) return NextResponse.json({ error: "Failed to unpublish" }, { status: 500 });
  return NextResponse.json({ success: true });
}
