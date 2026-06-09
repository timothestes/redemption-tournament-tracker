'use client';

import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Shared keyboard navigation for multiplayer toasts.
//
// Every interactive toast (card-choice prompt, pause/resume consent, spectator
// hand request, rematch banner, opponent-left modal) registers an entry here
// while it is on screen. A single document-level keydown listener routes
// ArrowLeft / ArrowRight / Enter / Escape to the ONE active entry — the highest
// priority, ties broken by most-recently-registered. This keeps stacked prompts
// and overlapping toasts from double-firing.
// ---------------------------------------------------------------------------

/**
 * Box-shadow for the currently-focused toast option. A thin ring in the
 * button's OWN accent color plus a soft glow — a deliberate "selected"
 * indicator, distinct from the jarring global focus ring on form controls.
 */
export function toastFocusShadow(ring: string, glow: string): string {
  return `0 0 0 2px ${ring}, 0 0 16px ${glow}`;
}

export interface ToastNavEntry {
  /** Higher wins. Card-choice prompts / modals sit above plain banners. */
  priority: number;
  onLeft: () => void;
  onRight: () => void;
  onEnter: () => void;
  onEscape: () => void;
}

const stack: ToastNavEntry[] = [];

/** Highest priority, ties broken by most-recently-registered (last in array). */
export function pickActiveEntry(entries: ToastNavEntry[]): ToastNavEntry | null {
  let best: ToastNavEntry | null = null;
  for (const e of entries) {
    if (!best || e.priority >= best.priority) best = e;
  }
  return best;
}

/**
 * Route a key to the active entry. Pure so it can be unit-tested without a DOM.
 * Returns whether the key was handled.
 */
export function dispatchToastKey(
  key: string,
  isTextInput: boolean,
  entries: ToastNavEntry[] = stack,
): boolean {
  if (isTextInput) return false;
  const active = pickActiveEntry(entries);
  if (!active) return false;
  switch (key) {
    case 'ArrowLeft':
      active.onLeft();
      return true;
    case 'ArrowRight':
      active.onRight();
      return true;
    case 'Enter':
      active.onEnter();
      return true;
    case 'Escape':
      active.onEscape();
      return true;
    default:
      return false;
  }
}

export function registerToastNav(entry: ToastNavEntry): () => void {
  stack.push(entry);
  return () => {
    const i = stack.indexOf(entry);
    if (i >= 0) stack.splice(i, 1);
  };
}

let listening = false;

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function ensureListener(): void {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  document.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (stack.length === 0) return;
      const handled = dispatchToastKey(e.key, isTextInputTarget(e.target));
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseToastKeyboardNavOptions {
  /** Number of selectable options. */
  count: number;
  /** Index focused initially / after a reset (the affirmative "yes"). */
  defaultIndex: number;
  /** Only the active toast should be enabled. Defaults to true. */
  enabled?: boolean;
  /** Higher wins when multiple toasts are visible. Defaults to 0. */
  priority?: number;
  /** Confirm the option at `index`. */
  onSelect: (index: number) => void;
  /** Negative response (Esc). */
  onCancel: () => void;
}

/**
 * Wire arrow/Enter/Esc navigation for a single toast. Returns the focused
 * option index (or -1 when disabled) plus a setter so mouse hover can keep the
 * highlight in sync with the keyboard.
 */
export function useToastKeyboardNav({
  count,
  defaultIndex,
  enabled = true,
  priority = 0,
  onSelect,
  onCancel,
}: UseToastKeyboardNavOptions): { focusedIndex: number; setFocusedIndex: (i: number) => void } {
  const [focused, setFocused] = useState(defaultIndex);

  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const countRef = useRef(count);
  countRef.current = count;
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  // Reset to the default selection whenever the toast (re)activates or its
  // options change.
  useEffect(() => {
    if (enabled) setFocused(defaultIndex);
  }, [enabled, defaultIndex, count]);

  useEffect(() => {
    if (!enabled || count <= 0) return;
    ensureListener();
    return registerToastNav({
      priority,
      onLeft: () => setFocused(i => (i - 1 + countRef.current) % countRef.current),
      onRight: () => setFocused(i => (i + 1) % countRef.current),
      onEnter: () => selectRef.current(focusedRef.current),
      onEscape: () => cancelRef.current(),
    });
  }, [enabled, count, priority]);

  return { focusedIndex: enabled ? focused : -1, setFocusedIndex: setFocused };
}
