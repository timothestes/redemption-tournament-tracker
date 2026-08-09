/** Gap kept between the menu and the viewport edge. */
export const MENU_MARGIN = 8;

export interface MenuSize {
  width: number;
  height: number;
}

/**
 * Place a context menu so its top-left corner sits at the cursor.
 *
 * Vertically the menu is only nudged up by however much it would overrun the
 * bottom edge — never to a fixed line. The sidebar piles sit low on the board,
 * so a fixed clamp (the old `Math.min(y, innerHeight - 300)`) swallowed the
 * entire pile's worth of cursor movement and left the menu looking bolted in
 * place. Nudging only on real overflow keeps the menu tracking the cursor 1:1
 * everywhere it fits, which is everywhere the piles actually are.
 *
 * Horizontally it flips to the left of the cursor instead, since a menu
 * anchored past the right edge would otherwise be squeezed against it.
 *
 * `menu` must be the *measured* size — the bug this replaces came from
 * guessing a height that was ~90px too large.
 */
export function anchorContextMenu(
  x: number,
  y: number,
  menu: MenuSize,
  viewport: MenuSize,
  margin = MENU_MARGIN,
): { left: number; top: number } {
  const onScreen = (pos: number, size: number, extent: number) =>
    Math.max(margin, Math.min(pos, Math.max(margin, extent - size - margin)));

  const flipped = x + menu.width > viewport.width - margin ? x - menu.width : x;

  return {
    left: onScreen(flipped, menu.width, viewport.width),
    top: onScreen(y, menu.height, viewport.height),
  };
}
