import { NextRequest, NextResponse } from "next/server";
import { isNumericEpisode, pickPreviousEpisode, sortDraftsForList } from "../../episodes";
import { notFoundResponse, requireThreshingFloor } from "../auth";

// GET /threshingfloor/api/drafts            -> [{ episode_number, updated_at }]
// GET /threshingfloor/api/drafts?before=100 -> full row of the previous numeric episode
export async function GET(request: NextRequest) {
  const auth = await requireThreshingFloor();
  if (!auth) return notFoundResponse();
  const { supabase } = auth;

  const before = request.nextUrl.searchParams.get("before");

  if (before !== null) {
    if (!isNumericEpisode(before.trim())) {
      return NextResponse.json(
        { error: "before must be a numeric episode number" },
        { status: 400 }
      );
    }
    const { data: rows, error } = await supabase
      .from("threshing_floor_drafts")
      .select("episode_number");
    if (error) {
      return NextResponse.json({ error: "Failed to load drafts" }, { status: 500 });
    }
    const prev = pickPreviousEpisode(
      (rows ?? []).map((r) => r.episode_number),
      before.trim()
    );
    if (!prev) return notFoundResponse();

    const { data: row, error: rowError } = await supabase
      .from("threshing_floor_drafts")
      .select("episode_number, data, updated_at")
      .eq("episode_number", prev)
      .single();
    if (rowError || !row) return notFoundResponse();
    return NextResponse.json(row);
  }

  const { data, error } = await supabase
    .from("threshing_floor_drafts")
    .select("episode_number, updated_at, published_at");
  if (error) {
    return NextResponse.json({ error: "Failed to load drafts" }, { status: 500 });
  }
  return NextResponse.json(sortDraftsForList(data ?? []));
}
