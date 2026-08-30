'use client';

import { useInputMode } from '@/app/shared/hooks/useInputMode';

/**
 * Sets `data-input-mode="pointer|touch"` on <html>.
 *
 * Input mode is a property of the DEVICE, not of any one page, so this is
 * mounted once in the root layout. Global CSS keys off the attribute to give
 * the context menus and the game toolbar touch-sized presentation without
 * either component knowing about input mode.
 *
 * Renders nothing; the hook performs the reflection.
 */
export function InputModeReflector() {
  useInputMode();
  return null;
}
