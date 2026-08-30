'use client';

// Long-press → context-popup tracking for the DOM card modals (deck search,
// deck peek, zone/opponent browse). Their card action popups historically
// opened on onContextMenu only — iOS Safari never fires contextmenu for
// touches, so on an iPhone every popup was unreachable. Each modal arms this
// tracker from onTouchStart and opens its popup when the timer fires.
// Chrome/Android fires a native contextmenu for the same hold; both paths
// landing just re-sets the same popup state, so no dedupe is needed.

export const CARD_LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 12;

export interface CardPressTracker {
  timer: ReturnType<typeof setTimeout> | null;
  startX: number;
  startY: number;
  // True once the menu fired — the trailing pointerup on the card is
  // swallowed instead of toggling selection under the open popup.
  fired: boolean;
}

type TrackerRef = { current: CardPressTracker | null };

export function beginCardPress(
  ref: TrackerRef,
  e: React.TouchEvent,
  fire: (clientX: number, clientY: number) => void,
): void {
  if (e.touches.length !== 1) {
    cancelCardPress(ref);
    return;
  }
  const t = e.touches[0];
  cancelCardPress(ref);
  const tracker: CardPressTracker = { timer: null, startX: t.clientX, startY: t.clientY, fired: false };
  tracker.timer = setTimeout(() => {
    tracker.timer = null;
    tracker.fired = true;
    fire(tracker.startX, tracker.startY);
  }, CARD_LONG_PRESS_MS);
  ref.current = tracker;
}

export function moveCardPress(ref: TrackerRef, e: React.TouchEvent): void {
  const tr = ref.current;
  if (!tr?.timer) return;
  const t = e.touches[0];
  if (!t) return;
  if (Math.hypot(t.clientX - tr.startX, t.clientY - tr.startY) > MOVE_TOLERANCE) {
    cancelCardPress(ref);
  }
}

// Clears the tracker. Callers order their reads before this: within one
// press, pointerup (swallow) and then touchend (preventDefault) both check
// cardPressFired before touchend's cancelCardPress wipes the state.
export function cancelCardPress(ref: TrackerRef): void {
  const tr = ref.current;
  if (tr?.timer) clearTimeout(tr.timer);
  ref.current = null;
}

// Whether this press's long-press already fired. Read by BOTH trailing
// handlers of the same press: pointerup (to swallow the selection toggle) and
// touchend (to preventDefault, suppressing the synthesized mouse click that
// would otherwise land on — or outside — the just-opened popup and act on it).
// pointerup fires BEFORE touchend, so this must not clear the flag: the
// tracker is simply overwritten by the next press's beginCardPress.
export function cardPressFired(ref: TrackerRef): boolean {
  return !!ref.current?.fired;
}

export const consumeCardPressFired = cardPressFired;
