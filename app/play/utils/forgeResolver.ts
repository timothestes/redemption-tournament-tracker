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

/**
 * Resolve a `{ name, img }` pair for the GAME LOG. Server-generated log payloads
 * copy the card's identity straight off the world-readable STDB row, where the
 * leak spine has blanked forge cards to `{ name: "", img: "forge:<uuid>" }`. The
 * board re-hydrates the real name/art client-side (see `cardInstanceToGameCard`);
 * the log must do the same so reserved/moved forge cards aren't logged nameless.
 *
 * - Non-forge card → returned unchanged (name always resolved; blank img → '').
 * - Granted forge card → real name + proxy art (or '' art when the card has none).
 * - Ungranted forge card → neutral "a playtest card" placeholder; never leaks the
 *   unreleased name to viewers without the RLS grant.
 */
export function resolveLogCard(
  name: string,
  img: string | undefined,
  resolver?: ForgeResolverMap | null,
): { name: string; img: string } {
  const forgeId = img ? forgeCardIdFromImgFile(img) : null;
  if (!forgeId) return { name, img: img ?? '' };
  const e = resolver?.get(forgeId);
  if (!e) return { name: 'a playtest card', img: '' };
  return { name: e.name, img: forgeProxyUrl(e) };
}

function isForgeRef(img: unknown): img is string {
  return typeof img === 'string' && img.startsWith('forge:');
}

// Resolve a { <nameKey>, <imgKey> } pair on `obj` in place, but only when the
// img is a forge ref — normal cards are left byte-for-byte untouched.
function resolveNamedCard(
  obj: Record<string, unknown>,
  nameKey: string,
  imgKey: string,
  resolver?: ForgeResolverMap | null,
): void {
  if (!isForgeRef(obj[imgKey])) return;
  const name = typeof obj[nameKey] === 'string' ? (obj[nameKey] as string) : '';
  const r = resolveLogCard(name, obj[imgKey], resolver);
  obj[nameKey] = r.name;
  obj[imgKey] = r.img;
}

/**
 * Normalize a game-LOG payload string so every forge card it references carries
 * the viewer's resolved name + proxy art (or the neutral "a playtest card"
 * placeholder when ungranted) instead of the blanked `{ name:"", img:"forge:<uuid>" }`
 * the server copies off the world-readable row.
 *
 * Applied once per action before `formatActionType` runs, this lets ChatPanel's
 * existing handlers — many of which gate on a truthy card name and would drop a
 * blank-named forge card to a generic label — treat forge cards like any named
 * card, and makes the log searchable by the resolved name. Covers every card
 * field the server emits (cardName/sourceCardName/tokenName + `{name,img}`
 * arrays/objects). Leak-safe: ungranted viewers never receive the real name.
 * Non-forge fields, non-object payloads (arrays, bare counts), and non-JSON
 * payloads are returned untouched.
 */
export function normalizeForgeLogPayload(
  payload: string | undefined,
  resolver?: ForgeResolverMap | null,
): string | undefined {
  if (!payload) return payload;
  // Fast path: forge refs are the only thing we rewrite, so a payload without one
  // (every action in a non-forge game) skips the parse/stringify round-trip.
  if (!payload.includes('forge:')) return payload;
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return payload;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return payload;
  const obj = data as Record<string, unknown>;

  resolveNamedCard(obj, 'cardName', 'cardImgFile', resolver);
  resolveNamedCard(obj, 'sourceCardName', 'sourceCardImgFile', resolver);
  resolveNamedCard(obj, 'tokenName', 'tokenImgFile', resolver);

  for (const key of ['cards', 'received', 'routedToLob', 'redirectedLostSouls']) {
    const arr = obj[key];
    if (!Array.isArray(arr)) continue;
    for (const el of arr) {
      if (el && typeof el === 'object') resolveNamedCard(el as Record<string, unknown>, 'name', 'img', resolver);
    }
  }
  for (const key of ['card', 'drew', 'drewCard']) {
    const el = obj[key];
    if (el && typeof el === 'object') resolveNamedCard(el as Record<string, unknown>, 'name', 'img', resolver);
  }
  return JSON.stringify(obj);
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
