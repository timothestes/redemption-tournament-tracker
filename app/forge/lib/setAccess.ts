// Pure helpers for the admin Set Access matrix. A grant is identified by the
// (playtester, set) pair; we key it as a single string for O(1) membership checks.

export function grantKey(userId: string, setId: string): string {
  return `${userId}|${setId}`;
}

export function buildGrantKeySet(pairs: { userId: string; setId: string }[]): Set<string> {
  return new Set(pairs.map((p) => grantKey(p.userId, p.setId)));
}
