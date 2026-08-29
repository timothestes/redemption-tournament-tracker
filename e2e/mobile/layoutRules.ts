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
