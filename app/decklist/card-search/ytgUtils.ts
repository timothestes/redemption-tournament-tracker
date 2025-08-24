/**
 * Utility functions for Your Turn Games integration
 */

/**
 * Converts a card name and set to a Your Turn Games product URL slug
 * Examples:
 * - "1,290 Days" + "T2C" -> "1-290-days-ttc"
 * - "Aaron's Rod" + "G Deck" -> "aarons-rod-g-deck"
 */
export function generateYTGProductSlug(cardName: string, cardSet: string): string {
  // Clean up the card name
  let slug = cardName
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Clean up the set name
  let setSlug = cardSet
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Combine with set in parentheses format that YTG uses
  return `${slug}-${setSlug}`;
}

/**
 * Generates the full Your Turn Games product URL for a card
 */
export function generateYTGProductURL(cardName: string, cardSet: string): string {
  const slug = generateYTGProductSlug(cardName, cardSet);
  return `https://www.yourturngames.biz/collections/singles/products/${slug}`;
}

/**
 * Generates a Your Turn Games search URL for a card name
 */
export function generateYTGSearchURL(cardName: string): string {
  const searchQuery = encodeURIComponent(cardName);
  return `https://www.yourturngames.biz/a/search?q=${searchQuery}`;
}

/**
 * Opens the Your Turn Games product page in a new tab
 */
export function openYTGProductPage(cardName: string, cardSet: string): void {
  const productUrl = generateYTGProductURL(cardName, cardSet);
  window.open(productUrl, '_blank', 'noopener,noreferrer');
}

/**
 * Opens the Your Turn Games search page for a card name
 */
export function openYTGSearchPage(cardName: string): void {
  const searchUrl = generateYTGSearchURL(cardName);
  window.open(searchUrl, '_blank', 'noopener,noreferrer');
}