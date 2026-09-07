"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CardEnlargeModal from "@/components/ui/CardEnlargeModal";
import { getCardImageUrl } from "@/app/shared/utils/cardImageUrl";
import { useInputMode } from "@/app/shared/hooks/useInputMode";

// An inline `[[Card Name]]` in an article. Pointer devices get a hover
// preview; every device gets tap/click → full-screen card. The name is a
// <button> (phrasing content) so it is valid inside <p> and reachable by
// keyboard, unlike a role="button" span.

const PREVIEW_W = 240;
const PREVIEW_H = Math.round((PREVIEW_W * 3.5) / 2.5);
const GAP = 8;
const HOVER_DELAY_MS = 150;

interface Pos {
  left: number;
  top: number;
}

/** Centre the preview on the anchor, above it when there is room, else below; clamp to the viewport. */
function placePreview(rect: DOMRect): Pos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.min(Math.max(GAP, rect.left + rect.width / 2 - PREVIEW_W / 2), vw - PREVIEW_W - GAP);
  const above = rect.top - GAP - PREVIEW_H;
  const top = above >= GAP ? above : Math.min(rect.bottom + GAP, Math.max(GAP, vh - PREVIEW_H - GAP));
  return { left, top };
}

export default function CardMention({
  name,
  imgFile,
  draft,
}: {
  name: string;
  imgFile?: string | null;
  /** Editor preview: flag a mention that resolved to nothing so the author sees the typo. */
  draft?: boolean;
}) {
  const src = imgFile ? getCardImageUrl(imgFile) : "";
  if (!src) {
    return draft ? (
      <span
        className="underline decoration-destructive decoration-wavy underline-offset-2"
        title={`No card named “${name}”`}
      >
        {name}
      </span>
    ) : (
      <span>{name}</span>
    );
  }
  return <ResolvedMention name={name} src={src} />;
}

function ResolvedMention({ name, src }: { name: string; src: string }) {
  const touch = useInputMode() === "touch";
  const anchor = useRef<HTMLButtonElement>(null);
  const timer = useRef<number | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [open, setOpen] = useState(false);

  const hide = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPos(null);
  }, []);

  const show = () => {
    // A synthetic mouseenter follows every tap on touch devices; the preview
    // would then sit under the finger with nothing to dismiss it.
    if (touch) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const el = anchor.current;
      if (el) setPos(placePreview(el.getBoundingClientRect()));
    }, HOVER_DELAY_MS);
  };

  // The preview is position: fixed, so any scroll would leave it floating
  // away from its name. Capture phase catches nested scroll containers too.
  useEffect(() => {
    if (!pos) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, {
      passive: true,
      capture: true,
    });
    return () => window.removeEventListener("scroll", onScroll, { capture: true });
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
        aria-haspopup="dialog"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => {
          hide();
          setOpen(true);
        }}
        // Mid-sentence, so it can't be padded to 44px without wrecking the
        // line. Grow the strike zone vertically instead: the inline box
        // grows, the visual line height does not.
        style={touch ? { padding: "6px 0", margin: "-6px 0" } : undefined}
        className="card-mention inline cursor-pointer text-left align-baseline underline decoration-foreground/40 decoration-dotted decoration-[1.5px] underline-offset-[3px] outline-none hover:text-primary hover:decoration-primary focus-visible:text-primary focus-visible:decoration-primary"
      >
        {name}
      </button>
      {pos &&
        createPortal(
          <div
            role="presentation"
            className="pointer-events-none fixed z-[60]"
            style={{
              left: pos.left,
              top: pos.top,
              width: PREVIEW_W,
              height: PREVIEW_H,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt=""
              width={PREVIEW_W}
              height={PREVIEW_H}
              decoding="async"
              className="h-full w-full rounded-lg bg-muted object-contain shadow-2xl ring-1 ring-black/20"
            />
          </div>,
          document.body,
        )}
      {open &&
        // Portaled: the mention sits inside a <p>, and the modal's own <div>/<p>
        // would otherwise nest inside it (invalid HTML, hydration warning).
        createPortal(
          <CardEnlargeModal onClose={() => setOpen(false)} name={name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={name}
              className="mx-auto w-full rounded-lg object-contain"
              style={{ aspectRatio: "2.5 / 3.5" }}
            />
          </CardEnlargeModal>,
          document.body,
        )}
    </>
  );
}
