'use client';

/**
 * Star of David (hexagram) — the visual cue for REG (Star) abilities during the
 * Pre-Game Phase.
 *
 * Drawn as two overlapping equilateral triangles in a single path with
 * `fillRule="evenodd"`, so the shared centre hexagon has winding count 2 and
 * renders hollow — matching the printed symbol rather than a solid star.
 *
 * Uses `currentColor` so callers tint it from the surrounding text colour
 * (gold #e8d5a3 / accent #c4955a in the play UI) instead of hard-coding a fill.
 *
 * The Konva canvas cannot mount this component; the equivalent on-card badge is
 * drawn with Konva primitives from STAR_OF_DAVID_POINTS below, so both surfaces
 * share one geometry definition.
 */

/** Circumradius-11 hexagram points on a 24×24 grid, centre (12, 12). */
export const STAR_OF_DAVID_UP_TRIANGLE = [12, 1, 21.53, 17.5, 2.47, 17.5] as const;
export const STAR_OF_DAVID_DOWN_TRIANGLE = [12, 23, 2.47, 6.5, 21.53, 6.5] as const;
/** Nominal viewBox edge the point sets above are expressed in. */
export const STAR_OF_DAVID_VIEWBOX = 24;

export default function StarOfDavidIcon({
  size = 14,
  title,
  style,
}: {
  size?: number;
  /** When set, renders an accessible label; omit for purely decorative use. */
  title?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${STAR_OF_DAVID_VIEWBOX} ${STAR_OF_DAVID_VIEWBOX}`}
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      style={{ display: 'inline-block', verticalAlign: 'text-bottom', flexShrink: 0, ...style }}
    >
      {title ? <title>{title}</title> : null}
      <path
        fillRule="evenodd"
        d="M12 1 L21.53 17.5 L2.47 17.5 Z M12 23 L2.47 6.5 L21.53 6.5 Z"
      />
    </svg>
  );
}
