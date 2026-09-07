// Loose-match key for a card name as a person would type it: single-spaced,
// straight quotes, lowercase. Pure — shared by the article renderer (client),
// the mention resolver and the card search (server).
export function cardNameKey(name: string): string {
  return name
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .toLowerCase();
}
