// Type-bucket naming shared by the public deck page and the article deck embed.
// Pure string maps — safe in any bundle.

/** Raw type abbreviations from the card data → readable names. */
export function prettifyTypeName(type: string): string {
  const map: Record<string, string> = {
    "GE": "Good Enhancement",
    "EE": "Evil Enhancement",
    "EC": "Evil Character",
    "HC": "Hero Character",
    "GC": "Good Character",
    "LS": "Lost Soul",
    "Dom": "Dominant",
    "Cov": "Covenant",
    "Cur": "Curse",
    "Art": "Artifact",
    "Fort": "Fortress",
    "Hero/GE": "Good Enhancement",
    "Evil Character/EE": "Evil Enhancement",
    // Dual-alignment enhancements used to surface as a raw "GE/EE" bucket.
    "GE/EE": "Dual-Alignment Enhancement",
  };
  return map[type] || type;
}

/** Group key used for display — small related types share a bucket. */
export function getGroupKey(type: string): string {
  const pretty = prettifyTypeName(type);
  if (pretty === "Artifact" || pretty === "Covenant" || pretty === "Curse") {
    return "Artifact/Covenant/Curse";
  }
  if (pretty === "Fortress" || pretty === "Site" || pretty === "City") {
    return "Fortress/Site";
  }
  return pretty;
}

/** Display-friendly group names (pluralized). */
export function getGroupDisplayName(group: string): string {
  const map: Record<string, string> = {
    "Hero": "Heroes",
    "Good Enhancement": "Good Enhancements",
    "Evil Character": "Evil Characters",
    "Evil Enhancement": "Evil Enhancements",
    "Dual-Alignment Enhancement": "Dual-Alignment Enhancements",
    "Lost Soul": "Lost Souls",
    "Artifact/Covenant/Curse": "Artifacts / Covenants / Curses",
    "Fortress/Site": "Fortresses / Sites",
    "Dominant": "Dominants",
  };
  return map[group] || group;
}
