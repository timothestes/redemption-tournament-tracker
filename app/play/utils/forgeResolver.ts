// Client-side forge card resolution. STDB rows carry only `forge:<uuid>` in
// cardImgFile; these helpers merge the viewer's RLS-granted card text and
// rewrite image URLs to the cookie-authed forge art proxy. Unresolved cards
// (viewer lacks the grant) stay opaque — fail-closed by design.
import { getCardImageUrl } from '@/app/shared/utils/cardImageUrl';
import type { ForgePlayResolverEntry } from '@/app/forge/lib/playDecks';
import type { GameCardData } from '@/app/play/actions';

export type ForgeResolverMap = Map<string, ForgePlayResolverEntry>;

export function forgeCardIdFromImgFile(imgFile: string): string | null {
  return imgFile.startsWith('forge:') ? imgFile.slice('forge:'.length) : null;
}

export function forgeProxyUrl(e: ForgePlayResolverEntry): string {
  if (e.hasFinished) return `/forge/api/art/${e.cardId}?v=approved&kind=finished&t=${e.versionId}`;
  if (e.hasArt) return `/forge/api/art/${e.cardId}?v=approved&t=${e.versionId}`;
  return '';
}

export function resolveCardImageUrl(imgFile: string, resolver?: ForgeResolverMap | null): string {
  const forgeId = forgeCardIdFromImgFile(imgFile);
  if (forgeId) {
    const e = resolver?.get(forgeId);
    return e ? forgeProxyUrl(e) : '';
  }
  return getCardImageUrl(imgFile);
}

// Re-hydrate the battle-math fields the leak spine blanked on a forge
// CardInstance row (name/brigade/strength/toughness), from the viewer's
// granted resolver. Deliberately NOT specialAbility: the auto-return summary
// must predict the server's routing, and the server only ever sees the
// blanked row (a forge "place" enhancement goes to discard server-side, so
// the client summary has to say the same). Ungranted forge rows come back
// unchanged — blank stats read as "unknown" in the band, fail-closed.
export function resolveBattleRowFields(
  row: { cardImgFile: string; cardName: string; brigade: string; strength: string; toughness: string },
  resolver?: ForgeResolverMap | null,
): { cardName: string; brigade: string; strength: string; toughness: string } {
  const forgeId = forgeCardIdFromImgFile(row.cardImgFile);
  const e = forgeId ? resolver?.get(forgeId) : undefined;
  if (!e) {
    return { cardName: row.cardName, brigade: row.brigade, strength: row.strength, toughness: row.toughness };
  }
  return { cardName: e.name, brigade: e.brigade, strength: e.strength, toughness: e.toughness };
}

export function mergeForgeDeckData(cards: GameCardData[], resolver?: ForgeResolverMap | null): GameCardData[] {
  if (!resolver || resolver.size === 0) return cards;
  return cards.map((c) => {
    const id = forgeCardIdFromImgFile(c.cardImgFile);
    if (!id) return c;
    const e = resolver.get(id);
    if (!e) return c;
    // Restore the searchable fields the leak spine blanked on the STDB row, so
    // the in-game Search Deck modal can filter forge cards by alignment/brigade/
    // identifier/reference (not just name/type/ability).
    return {
      ...c,
      cardName: e.name,
      specialAbility: e.rawText,
      cardImgFile: forgeProxyUrl(e) || c.cardImgFile,
      alignment: e.alignment,
      brigade: e.brigade,
      strength: e.strength,
      toughness: e.toughness,
      identifier: e.identifier,
      reference: e.reference,
    };
  });
}
