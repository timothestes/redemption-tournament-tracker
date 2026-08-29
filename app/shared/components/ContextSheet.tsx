'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';

interface ContextSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

/**
 * Bottom sheet used as the touch presentation for the board's context menus.
 *
 * Portals to <body> for the same reason MobileDrawer does: an ancestor with a
 * transform/filter becomes the containing block for fixed children and would
 * confine the backdrop, breaking tap-to-dismiss (see the PR #229 regression).
 *
 * Rows rendered inside should use CONTEXT_SHEET_ROW_CLASS so they clear 44px.
 */
export function ContextSheet({ open, onClose, title, children }: ContextSheetProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 bg-black/60 z-[60]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            data-testid="context-sheet-backdrop"
          />
          <motion.div
            className="fixed left-0 right-0 bottom-0 z-[61] max-h-[70dvh] overflow-y-auto
                       rounded-t-2xl border-t border-neutral-700 bg-neutral-900
                       pb-[env(safe-area-inset-bottom)]"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            data-testid="context-sheet"
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="h-1 w-10 rounded-full bg-neutral-600" />
            </div>
            {title && (
              <div className="px-4 pb-2 pt-1 text-sm font-semibold text-neutral-200">
                {title}
              </div>
            )}
            <div className="pb-2">{children}</div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Row sizing for touch: >=44px tall (WCAG 2.5.5 AAA / Apple HIG), 15px text. */
export const CONTEXT_SHEET_ROW_CLASS =
  'flex w-full items-center gap-3 px-4 py-3 text-[15px] leading-tight min-h-[44px] ' +
  'text-neutral-100 active:bg-neutral-800';
