// Set artwork export helpers. The pure helpers (artExt/artFileName) are unit-tested;
// listSetApprovedArt is SERVER-ONLY (it reads private blob keys — never serialize its
// result to a client component).
import { requireForge } from "@/app/forge/lib/auth";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

/** Map a blob content-type to a file extension; 'img' for anything unknown. Pure. */
export function artExt(contentType: string): string {
  return EXT_BY_TYPE[contentType] ?? "img";
}

/** `{NN}_{slug}.{ext}` — zero-padded sequence, slugified name (fallback 'card'). Pure. */
export function artFileName(seq: number, name: string, ext: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "card";
  return `${String(seq).padStart(2, "0")}_${slug}.${ext}`;
}

export type ApprovedArt = {
  cardId: string;
  name: string;
  key: string;
  isPlaceholder: boolean;
  versionNumber: number;
};

/**
 * SERVER-ONLY. The approved cards of a set with exportable art, read under the
 * caller's RLS (set-elder/superadmin can read the set's approved card_versions).
 * Returns only entries with real, non-placeholder art. Carries blob keys — never
 * pass the result to a client component; derive a boolean/count instead.
 */
export async function listSetApprovedArt(setId: string): Promise<ApprovedArt[]> {
  const ctx = await requireForge();
  if (!ctx) return [];

  const { data: cards } = await ctx.supabase
    .from("forge_cards")
    .select("approved_version_id")
    .eq("set_id", setId)
    .eq("status", "approved")
    .not("approved_version_id", "is", null);

  const versionIds = (cards ?? [])
    .map((c: any) => c.approved_version_id)
    .filter((id: any): id is string => !!id);
  if (versionIds.length === 0) return [];

  const { data: versions } = await ctx.supabase
    .from("card_versions")
    .select("id, card_id, version_number, data, art_key, art_original_key, art_is_placeholder")
    .eq("status", "approved") // self-defend: don't lean solely on the approve RPC keeping these in lockstep
    .in("id", versionIds);

  return (versions ?? [])
    .map((v: any) => ({
      cardId: v.card_id as string,
      name: (v.data?.name ?? "").toString(),
      key: (v.art_original_key ?? v.art_key ?? "") as string,
      isPlaceholder: !!v.art_is_placeholder,
      versionNumber: (v.version_number ?? 0) as number,
    }))
    .filter((a: ApprovedArt) => a.key !== "" && !a.isPlaceholder);
}
