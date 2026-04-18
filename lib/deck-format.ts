export type DeckFormat = 'T1' | 'T2' | 'Paragon';

/**
 * Canonicalizes any deck-format string ("Type 1", "t2", "Paragon Type 1",
 * "Multi-player", etc.) to a single tag used for matchmaking.
 *
 * Must mirror `normalizeFormat` in spacetimedb/src/index.ts so the
 * client-side pre-flight check and the server-side reducer check agree.
 */
export function normalizeDeckFormat(format: string | null | undefined): DeckFormat {
  const fmt = (format ?? '').toLowerCase();
  if (fmt.includes('paragon')) return 'Paragon';
  if (fmt.includes('type 2') || fmt.includes('multi') || fmt === 't2') return 'T2';
  return 'T1';
}
