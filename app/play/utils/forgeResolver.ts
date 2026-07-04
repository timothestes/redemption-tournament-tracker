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

export function mergeForgeDeckData(cards: GameCardData[], resolver?: ForgeResolverMap | null): GameCardData[] {
  if (!resolver || resolver.size === 0) return cards;
  return cards.map((c) => {
    const id = forgeCardIdFromImgFile(c.cardImgFile);
    if (!id) return c;
    const e = resolver.get(id);
    if (!e) return c;
    return { ...c, cardName: e.name, specialAbility: e.rawText, cardImgFile: forgeProxyUrl(e) || c.cardImgFile };
  });
}
