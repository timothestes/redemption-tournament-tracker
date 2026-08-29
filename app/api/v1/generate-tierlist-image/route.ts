import { NextResponse } from "next/server";
import { guard } from "@/lib/decksheets/routeGuard";
import { uploadDeckArtifact } from "@/lib/decksheets/upload";
import { generateTierListImage, type TierListImageRow } from "@/lib/tierlist/tierListImage";

export const runtime = "nodejs";

// Bounds on the payload — the renderer fetches one Blob image per distinct card,
// so an unbounded body is an unbounded fan-out.
const MAX_ROWS = 20;
const MAX_CARDS = 200;
const MAX_LABEL = 24;
const MAX_TITLE = 80;

function err(message: string, status: number) {
  return NextResponse.json({ status: "error", message }, { status });
}

function parseRows(input: unknown): TierListImageRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_ROWS) return null;
  const rows: TierListImageRow[] = [];
  let total = 0;
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return null;
    const { label, color, cards } = raw as Record<string, unknown>;
    if (typeof label !== "string" || typeof color !== "string") return null;
    if (!Array.isArray(cards)) return null;
    total += cards.length;
    if (total > MAX_CARDS) return null;
    const parsed = cards.map((c) => {
      if (!c || typeof c !== "object") return null;
      const { name, set } = c as Record<string, unknown>;
      if (typeof name !== "string" || typeof set !== "string" || !name) return null;
      return { name, set };
    });
    if (parsed.some((c) => c === null)) return null;
    rows.push({
      label: label.slice(0, MAX_LABEL),
      color,
      cards: parsed as Array<{ name: string; set: string }>,
    });
  }
  return rows;
}

export async function POST(req: Request) {
  const limited = await guard(req);
  if (limited) return limited;

  let data: unknown;
  try {
    data = await req.json();
  } catch {
    return err("invalid request", 400);
  }
  if (!data || typeof data !== "object") return err("invalid request", 400);

  const body = data as Record<string, unknown>;
  const rows = parseRows(body.rows);
  if (!rows) return err("invalid request", 400);
  if (rows.every((r) => r.cards.length === 0)) return err("Add at least one card before exporting.", 400);
  const title = typeof body.title === "string" ? body.title.slice(0, MAX_TITLE) : null;

  try {
    const bytes = await generateTierListImage({ rows, title });
    // Shares the generated-artifact bucket the deck sheet images already use.
    const uploaded = await uploadDeckArtifact(`tierlists/${crypto.randomUUID()}.png`, bytes, "image/png");
    return NextResponse.json(
      { status: "success", message: "tier list image generated successfully", data: uploaded },
      { status: 201 },
    );
  } catch (e) {
    console.error("[generate-tierlist-image]", e);
    return err("something unexpected happened", 500);
  }
}
