/**
 * Deterministic layout rules, kept pure so vitest can unit-test them and the
 * Playwright specs / screenshot harness can share the exact same thresholds.
 *
 * Standards:
 *   WCAG 2.5.8 (AA)  - 24x24 CSS px minimum, or 24px spacing
 *   WCAG 2.5.5 (AAA) - 44x44 CSS px
 *   Apple HIG 44x44pt, Material 48x48dp
 *
 * Game cards take the WCAG "essential" exception on RENDERED size - a board
 * that fits must draw them small - but their tap hit-region must still reach
 * MIN_TARGET_PX.
 */

export const MIN_TARGET_PX = 44;
export const ABSOLUTE_MIN_TARGET_PX = 24;
export const MIN_FONT_PX = 11;

export interface RuleResult {
  ok: boolean;
  severity: 'error' | 'warning' | null;
  message: string;
}

const PASS: RuleResult = { ok: true, severity: null, message: '' };

export function checkTargetSize(box: { width: number; height: number }): RuleResult {
  const min = Math.min(box.width, box.height);
  if (min >= MIN_TARGET_PX) return PASS;
  if (min < ABSOLUTE_MIN_TARGET_PX) {
    return {
      ok: false,
      severity: 'error',
      message: `target ${Math.round(box.width)}x${Math.round(box.height)} is below the WCAG 2.5.8 AA floor of ${ABSOLUTE_MIN_TARGET_PX}px`,
    };
  }
  return {
    ok: false,
    severity: 'warning',
    message: `target ${Math.round(box.width)}x${Math.round(box.height)} is below the ${MIN_TARGET_PX}px AAA target`,
  };
}

export function checkFontSize(px: number): RuleResult {
  if (px >= MIN_FONT_PX) return PASS;
  return {
    ok: false,
    severity: 'error',
    message: `font size ${px}px is below the ${MIN_FONT_PX}px legibility floor`,
  };
}

/** Viewports the mobile suites and the screenshot harness both iterate. */
export const MOBILE_VIEWPORTS = [
  { name: 'iphone-14-pro-landscape', width: 852, height: 393 },
  { name: 'iphone-se-landscape', width: 667, height: 375 },
  { name: 'ipad-mini-landscape', width: 1133, height: 744 },
  { name: 'ipad-pro-11-landscape', width: 1194, height: 834 },
  { name: 'iphone-14-pro-portrait', width: 393, height: 852 },
  { name: 'desktop-baseline', width: 1920, height: 1080 },
] as const;

// ── Occlusion ──────────────────────────────────────────────────────────────
/**
 * The hand band is the one part of the board a player touches every single
 * turn, and its cards cannot be moved out from under an overlay the way
 * territory cards can. Floating chrome must therefore stay out of it.
 *
 * This rule exists because target-size and font-size checks are structurally
 * blind to occlusion: a 44px button that sits on top of the hand passes both.
 * The floating toolbar covered 89-97% of the hand band on phones and every
 * automated check reported clean.
 */
export const MAX_HAND_BAND_OCCLUSION_PCT = 15;
/** Above this, enough of the hand is hidden that play is obstructed rather
 *  than merely cramped. Calibrated against the bar that shipped first: it
 *  covered 81% of the band's height across 59% of its width = 48% coverage,
 *  and it made six of eight cards untappable. */
export const HAND_BAND_OCCLUSION_ERROR_PCT = 40;

export interface Box { top: number; left: number; width: number; height: number }

/** Vertical overlap between an overlay and the hand band, as a percentage of
 *  the band. Vertical-only on purpose: the hand fans across the full width, so
 *  a bar that merely moves left still covers cards. */
export function handBandOcclusionPct(overlay: Box, handBand: Box): number {
  if (handBand.height <= 0) return 0;
  const overlap = Math.min(overlay.top + overlay.height, handBand.top + handBand.height)
    - Math.max(overlay.top, handBand.top);
  if (overlap <= 0) return 0;
  return Math.round((overlap / handBand.height) * 100);
}

/**
 * How much of the hand a piece of chrome actually costs the player: vertical
 * overlap weighted by how much of the band's WIDTH it spans.
 *
 * The weighting matters because the hand fans across the full width. A
 * full-width bar at 90% vertical overlap hides nearly every card; a 44px
 * corner control at the same vertical overlap hides part of one. Treating
 * those the same would either wave through the bar or forbid any corner
 * control at all.
 */
export function handBandCoveragePct(overlay: Box, handBand: Box): number {
  if (handBand.height <= 0 || handBand.width <= 0) return 0;
  const vPct = handBandOcclusionPct(overlay, handBand);
  if (vPct === 0) return 0;
  const hOverlap = Math.min(overlay.left + overlay.width, handBand.left + handBand.width)
    - Math.max(overlay.left, handBand.left);
  if (hOverlap <= 0) return 0;
  return Math.round((vPct * (hOverlap / handBand.width)));
}

export function checkHandBandOcclusion(overlay: Box, handBand: Box): RuleResult {
  const coverage = handBandCoveragePct(overlay, handBand);
  if (coverage <= MAX_HAND_BAND_OCCLUSION_PCT) return PASS;
  const vPct = handBandOcclusionPct(overlay, handBand);
  return {
    ok: false,
    severity: coverage > HAND_BAND_OCCLUSION_ERROR_PCT ? 'error' : 'warning',
    message: `overlay hides ${coverage}% of the hand band `
      + `(${vPct}% of its height across ${Math.round(overlay.width / handBand.width * 100)}% of its width; `
      + `max ${MAX_HAND_BAND_OCCLUSION_PCT}%)`,
  };
}
