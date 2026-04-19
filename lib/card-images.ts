export function getCardImageUrl(
  cardName: string | null | undefined,
): string | null {
  if (!cardName) return null;
  const blobBase = process.env.NEXT_PUBLIC_BLOB_BASE_URL;
  if (!blobBase) return null;
  const sanitized = cardName.replace(/\//g, "_");
  return `${blobBase}/card-images/${sanitized}.jpg`;
}
