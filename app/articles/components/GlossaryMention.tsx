"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useInputMode } from "@/app/shared/hooks/useInputMode";
import type { GlossaryTerm } from "@/lib/glossary/terms";

// An inline `[[EC]]` — community shorthand that is not a card. Sibling of
// CardMention: same chip geometry, so references read as one family, but the
// popover is a line of text rather than a card, and there is no modal. The page
// keeps the author's shorthand; the expansion is the way in for a newcomer.
//
// Quieter than a card mention on purpose (no ring, dotted underline): a card is
// a thing you want to look at, a term is a thing you occasionally need defined.

const GAP = 8;
const MAX_W = 260;
const HOVER_DELAY_MS = 150;

interface Pos {
  left: number;
  top: number;
  below: boolean;
}

function place(rect: DOMRect): Pos {
  const vw = window.innerWidth;
  const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - MAX_W / 2), Math.max(GAP, vw - MAX_W - GAP));
  // Above when there is room — a tooltip under the caret hides the next line.
  const below = rect.top < 72;
  return { left, top: below ? rect.bottom + GAP : rect.top - GAP, below };
}

export default function GlossaryMention({ text, entry }: { text: string; entry: GlossaryTerm }) {
  const touch = useInputMode() === "touch";
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const hide = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPos(null);
  }, []);

  const show = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const el = anchor.current;
      if (el) setPos(place(el.getBoundingClientRect()));
    }, HOVER_DELAY_MS);
  }, []);

  // Scroll and resize move the anchor out from under a fixed tooltip.
  useEffect(() => {
    if (!pos) return;
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [pos, hide]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-label={`${text} — ${entry.expansion}`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // No modal to open: on touch a tap is the only way to see the
        // expansion, so it toggles the same popover hover uses.
        onClick={() => (pos ? hide() : show())}
        className={[
          "glossary-mention box-decoration-clone inline cursor-help rounded-[3px] bg-foreground/[0.05] px-[0.28em]",
          "text-left align-baseline underline decoration-foreground/30 decoration-dotted underline-offset-[3px] outline-none",
          "hover:bg-primary/10 hover:text-primary hover:decoration-primary/50",
          "focus-visible:bg-primary/10 focus-visible:text-primary focus-visible:decoration-primary/50",
          // Same trick CardMention uses: the chip cannot be padded to 44px
          // mid-sentence, so an invisible overlay grows the strike zone.
          touch ? "relative before:absolute before:inset-x-0 before:-inset-y-[7px] before:content-['']" : "",
        ].join(" ")}
      >
        {text}
      </button>
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[60] rounded-md bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg ring-1 ring-border"
            style={{
              left: pos.left,
              top: pos.top,
              maxWidth: MAX_W,
              transform: pos.below ? undefined : "translateY(-100%)",
            }}
          >
            <span className="block font-medium">{entry.expansion}</span>
            <span className="block text-xs text-muted-foreground">
              {entry.kind === "set" ? "Set" : "Game term"}
            </span>
          </div>,
          document.body,
        )}
    </>
  );
}
