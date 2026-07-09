/**
 * Turn a card/deck name into a safe download filename (no extension).
 * Mirrors the whitespace-to-underscore convention used by the .txt exports,
 * and additionally strips characters that are illegal in filenames.
 */
export function sanitizeDeckFilename(deckName: string | null | undefined): string {
  const cleaned = (deckName ?? "")
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "") // strip filename-illegal characters
    .replace(/\s+/g, "_");
  return cleaned || "decklist";
}

/**
 * The tournament PDF service stores generated decklists in Supabase Storage,
 * whose public object URLs end in a random UUID (e.g. `.../decklists/<uuid>`).
 * Downloading that URL as-is saves a file named after the UUID.
 *
 * Supabase Storage honors a `download` query param that sets
 * `Content-Disposition: attachment; filename=<name>` on the response, so we
 * append the deck name here to give the saved PDF a meaningful name.
 * See: https://supabase.com/docs/guides/storage/serving/downloads
 */
export function decklistPdfDownloadUrl(
  rawUrl: string,
  deckName: string | null | undefined,
): string {
  const filename = `${sanitizeDeckFilename(deckName)}.pdf`;
  try {
    const url = new URL(rawUrl);
    url.searchParams.set("download", filename);
    return url.toString();
  } catch {
    // Not a parseable absolute URL — leave the link untouched rather than break it.
    return rawUrl;
  }
}
