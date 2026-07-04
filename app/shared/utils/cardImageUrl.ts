/**
 * Shared card image URL utilities.
 *
 * Consolidates the many duplicate definitions of sanitizeImgFile() and
 * getCardImageUrl() that were scattered across the codebase.
 */

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

/** Strip trailing .jpg / .jpeg extension so we can append a canonical one. */
export function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

/**
 * Build the full Vercel Blob URL for a card image.
 *
 * - Paths that already start with `/` are returned as-is (local assets).
 * - Empty strings return `''`.
 */
export function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  if (imgFile.startsWith('forge:')) return ''; // opaque Forge ref — resolved via the forge resolver, never the public CDN
  if (imgFile.startsWith('/')) return imgFile;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

/**
 * Nullable variant — useful for optional preview-card fields.
 *
 * Returns `null` when `imgFile` is nullish or the blob base URL is missing.
 */
export function getCardImageUrlOrNull(imgFile: string | null | undefined): string | null {
  if (!imgFile) return null;
  if (imgFile.startsWith('forge:')) return null;
  if (imgFile.startsWith('/')) return imgFile; // local assets & same-origin proxy URLs
  if (!BLOB_BASE_URL) return null;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}
