/**
 * Card image URLs for the deck builder. Now a thin wrapper over the shared
 * helper (app/shared/utils/cardImageUrl.ts) so cache-busting and path rules
 * live in exactly one place. The old STRATEGY switch is gone — 'blob' was the
 * only live branch.
 */
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";

export function getPublicImageUrl(imgFile: string): string {
  return getCardImageUrl(imgFile);
}

export function useCardImageUrl() {
  return { getImageUrl: getPublicImageUrl, strategy: "blob" as const };
}
