// Pending-deploy detection (spec §7, F4/F9): diff the LIVE tables against the
// BUNDLED committed overlay (what the running deploy was generated from) — in
// both directions, so deleted overrides that prod still serves are visible.
export type PendingItem = {
  kind: "override-new" | "override-changed" | "override-removed" | "image-bump";
  key: string;    // "name|set" or imgFile
  detail: string; // human line for the dashboard
};

export type DbState = {
  overrides: Array<{ card_name: string; set_code: string; fields: Record<string, string> }>;
  imageVersions: Record<string, number>;
};
export type BundledOverlay = {
  overrides: Array<{ name: string; set: string; fields: Record<string, string> }>;
  imageVersions: Record<string, number>;
};

const fieldsEqual = (a: Record<string, string>, b: Record<string, string>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

export function diffPending(db: DbState, bundled: BundledOverlay): PendingItem[] {
  const items: PendingItem[] = [];
  const bundledByKey = new Map(bundled.overrides.map((o) => [`${o.name}|${o.set}`, o]));
  const dbKeys = new Set<string>();

  for (const row of db.overrides) {
    const key = `${row.card_name}|${row.set_code}`;
    dbKeys.add(key);
    const shipped = bundledByKey.get(key);
    if (!shipped) {
      items.push({ kind: "override-new", key, detail: `New override for ${key} — not yet deployed` });
    } else if (!fieldsEqual(row.fields, shipped.fields)) {
      items.push({ kind: "override-changed", key, detail: `Override for ${key} changed since the last deploy` });
    }
  }
  for (const [key] of bundledByKey) {
    if (!dbKeys.has(key)) {
      items.push({
        kind: "override-removed", key,
        detail: `Override for ${key} was deleted but the deployed catalog still serves it`,
      });
    }
  }
  for (const [img, v] of Object.entries(db.imageVersions)) {
    if ((bundled.imageVersions[img] ?? 0) < v) {
      items.push({ kind: "image-bump", key: img, detail: `Image ${img} replaced (v${v}) — cache-bust ships with the next deploy` });
    }
  }
  return items;
}
