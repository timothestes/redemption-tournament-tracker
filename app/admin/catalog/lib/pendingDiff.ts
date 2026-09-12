import { cardNameKey } from "@/lib/cards/nameKey";

// Pending-deploy detection (spec §7, F4/F9): diff the LIVE tables against the
// BUNDLED committed overlay (what the running deploy was generated from) — in
// both directions, so deleted overrides that prod still serves are visible.
export type PendingItem = {
  kind:
    | "override-new"
    | "override-changed"
    | "override-removed"
    | "image-bump"
    | "alias-new"
    | "alias-changed"
    | "alias-removed";
  key: string;    // "name|set", imgFile, or the alias
  detail: string; // human line for the dashboard
};

export type DbState = {
  overrides: Array<{ card_name: string; set_code: string; fields: Record<string, string> }>;
  imageVersions: Record<string, number>;
  /** Optional: an overlay committed before aliases existed simply has none. */
  aliases?: Array<{ alias: string; card_name: string; set_code: string }>;
};
export type BundledOverlay = {
  overrides: Array<{ name: string; set: string; fields: Record<string, string> }>;
  imageVersions: Record<string, number>;
  aliases?: Array<{ alias: string; name: string; set: string }>;
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
  // Aliases key on the alias itself, folded with the same cardNameKey the
  // resolver uses — a re-cased alias is the same alias, not a new one (though
  // it is still pending, because the badge text changed).
  const shippedAliases = new Map((bundled.aliases ?? []).map((a) => [cardNameKey(a.alias), a]));
  const liveAliasKeys = new Set<string>();
  for (const row of db.aliases ?? []) {
    const key = cardNameKey(row.alias);
    liveAliasKeys.add(key);
    const shipped = shippedAliases.get(key);
    const target = `${row.card_name}|${row.set_code}`;
    if (!shipped) {
      items.push({ kind: "alias-new", key: row.alias, detail: `New alias ${row.alias} → ${target} — not yet deployed` });
    } else if (`${shipped.name}|${shipped.set}` !== target) {
      items.push({
        kind: "alias-changed", key: row.alias,
        detail: `Alias ${row.alias} now points at ${target} — the deployed catalog still serves ${shipped.name}|${shipped.set}`,
      });
    } else if (shipped.alias !== row.alias) {
      // Same alias as far as resolution is concerned, but the picker badge and
      // the editor chip show the stored casing, so the deploy is still stale.
      items.push({
        kind: "alias-changed", key: row.alias,
        detail: `Alias ${row.alias} was re-cased — the deployed catalog still shows ${shipped.alias}`,
      });
    }
  }
  for (const [key, shipped] of shippedAliases) {
    if (!liveAliasKeys.has(key)) {
      items.push({
        kind: "alias-removed", key: shipped.alias,
        detail: `Alias ${shipped.alias} was deleted but the deployed catalog still serves it`,
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
