/**
 * Konva hands us either a MouseEvent (which has `button`) or a TouchEvent
 * (which does not). Comparing `button === 0` therefore silently reports false
 * for every touch, which is what killed double-tap-to-meek on touch devices:
 * handleCardClick never incremented leftClicksSinceContextMenuRef, and
 * handleDblClick requires that counter to reach 2.
 *
 * Treat a missing `button` as the primary pointer.
 */
export function isPrimaryPointer(evt: { button?: number }): boolean {
  return evt.button === undefined || evt.button === 0;
}
