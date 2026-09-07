import { CATEGORY_BY_TERM_ID } from "./categoryMap";

export type LegacyWpResolution =
  | { kind: "none" }
  | { kind: "not-found" }
  | { kind: "redirect"; to: string };

/**
 * Resolves WordPress query-style URLs that only ever existed on the site root:
 * /?p=<id> and /?page_id=<id> short links (via posts.wp_post_id) and /?cat=<id>
 * category links (via the generated term-id map). A present-but-unresolvable
 * param is a 404, never a fall-through to the home page (soft-404 rule, spec §1).
 */
export async function resolveLegacyWpParams(
  params: { p?: string; page_id?: string; cat?: string },
  lookupSlugByWpId: (id: number) => Promise<string | null>,
): Promise<LegacyWpResolution> {
  const rawId = params.p ?? params.page_id;
  if (rawId !== undefined) {
    if (typeof rawId !== "string") return { kind: "not-found" };
    const id = Number(rawId);
    if (!Number.isInteger(id) || id < 1) return { kind: "not-found" };
    const slug = await lookupSlugByWpId(id);
    return slug ? { kind: "redirect", to: `/articles/${slug}` } : { kind: "not-found" };
  }
  if (params.cat !== undefined) {
    if (typeof params.cat !== "string") return { kind: "not-found" };
    const name = CATEGORY_BY_TERM_ID[params.cat.trim()];
    return name
      ? { kind: "redirect", to: `/articles?tag=${encodeURIComponent(name)}` }
      : { kind: "not-found" };
  }
  return { kind: "none" };
}
