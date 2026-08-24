export declare const EDITABLE_FIELDS: string[];
export declare const IDENTITY_FIELDS: string[];
export declare function applyCardOverrides(
  cards: Array<Record<string, string>>,
  overlay: { overrides?: Array<{ name: string; set: string; fields?: Record<string, unknown>; note?: string }>; imageVersions?: Record<string, number> } | Record<string, never>,
): { errors: string[]; warnings: string[] };
