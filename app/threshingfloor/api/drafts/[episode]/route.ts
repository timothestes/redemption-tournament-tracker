import { NextRequest, NextResponse } from "next/server";
import { normalizeEpisode } from "../../../episodes";
import { notFoundResponse, requireThreshingFloor } from "../../auth";

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

export async function GET(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const { data, error } = await auth.supabase
    .from("threshing_floor_drafts")
    .select("episode_number, data, updated_at")
    .eq("episode_number", episode)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Failed to load draft" }, { status: 500 });
  if (!data) return notFoundResponse();
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Draft too large (over 4 MB)" }, { status: 413 });
  }
  let body: { data?: unknown; lastSeenUpdatedAt?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    return NextResponse.json({ error: "data must be an object" }, { status: 400 });
  }

  const { data: existing, error: existingError } = await auth.supabase
    .from("threshing_floor_drafts")
    .select("updated_at")
    .eq("episode_number", episode)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: "Failed to check draft" }, { status: 500 });
  }
  if (
    existing &&
    typeof body.lastSeenUpdatedAt === "string" &&
    body.lastSeenUpdatedAt !== existing.updated_at
  ) {
    return NextResponse.json(
      { error: "Draft was modified by someone else" },
      { status: 409 }
    );
  }

  const { data: saved, error } = await auth.supabase
    .from("threshing_floor_drafts")
    .upsert(
      {
        episode_number: episode,
        data: body.data,
        updated_by: auth.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "episode_number" }
    )
    .select("episode_number, updated_at")
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });
  }
  return NextResponse.json(saved);
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const episode = await resolveEpisode(params);
  if (!episode) return NextResponse.json({ error: "Invalid episode number" }, { status: 400 });

  const { error } = await auth.supabase
    .from("threshing_floor_drafts")
    .delete()
    .eq("episode_number", episode);
  if (error) return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  return NextResponse.json({ success: true });
}
