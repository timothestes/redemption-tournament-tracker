/**
 * Hook to manage card image URLs with different strategies
 */

export function useCardImageUrl() {
  // Change this line to switch strategies:
  // 'local'  - Serve from /public/card-images/ (after running download script)
  // 'proxy'  - Use Next.js API proxy with caching
  // 'direct' - Direct from GitHub (original, slower)
  // 'blob'   - Vercel Blob CDN (fast, no GitHub dependency)

  // To switch, just change the string below:
  const STRATEGY = 'blob' as 'local' | 'proxy' | 'direct' | 'blob';

  const getImageUrl = (imgFile: string): string => {
    // Sanitize imgFile to avoid duplicate extensions
    const sanitizedImgFile = imgFile.replace(/\.jpe?g$/i, "");

    switch (STRATEGY) {
      case 'local':
        return `/card-images/${sanitizedImgFile}.jpg`;
      case 'proxy':
        return `/api/card-image/${sanitizedImgFile}.jpg`;
      case 'blob':
        return `${process.env.NEXT_PUBLIC_BLOB_BASE_URL}/card-images/${sanitizedImgFile}.jpg`;
      case 'direct':
        return `https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/${sanitizedImgFile}.jpg`;
      default:
        return `https://raw.githubusercontent.com/jalstad/RedemptionLackeyCCG/master/RedemptionQuick/sets/setimages/general/${sanitizedImgFile}.jpg`;
    }
  };

  return { getImageUrl, strategy: STRATEGY };
}
