import type { InputMode } from '@/app/shared/layout/inputMode';

/**
 * Below this width, a portrait board is structurally broken rather than merely
 * tight: RightPanel's 280px floor leaves roughly 113px of canvas on a 393px
 * viewport, which renders cards at about 6x8px. iPad portrait (834px) stays
 * above the line - it letterboxes, but remains usable.
 */
export const PORTRAIT_GATE_MAX_WIDTH = 700;

export function shouldGateForPortrait(
  width: number,
  height: number,
  inputMode: InputMode,
): boolean {
  if (inputMode !== 'touch') return false;
  if (width === 0 || height === 0) return false;
  return width < height && width < PORTRAIT_GATE_MAX_WIDTH;
}

/**
 * Touch viewports that get the compact layout profile (TOUCH_PROFILE) and the
 * overlaid turn bar: short landscape phones (h < 500) AND phone portrait
 * behind "Continue anyway" — which previously fell through to the desktop
 * profile and rendered the board as a ~25%-height microfilm strip. iPad
 * portrait (834x1112) stays on the standard profile, same as the gate.
 */
export function isCompactTouchViewport(
  width: number,
  height: number,
  inputMode: InputMode,
): boolean {
  if (inputMode !== 'touch') return false;
  if (width <= 0 || height <= 0) return false;
  return height < 500 || (width < height && width < PORTRAIT_GATE_MAX_WIDTH);
}
