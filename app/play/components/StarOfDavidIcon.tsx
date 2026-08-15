'use client';

/**
 * Star of David — the visual cue for REG (Star) abilities during the Pre-Game
 * Phase: the printed blue hexagram centred on a white disc.
 *
 * The hexagram is the real asset rather than drawn geometry. Its interlaced
 * form (hollow centre hexagon plus a hollow triangle inside each point) is not
 * two filled triangles, and a canvas fill cannot express it — an earlier gold
 * two-triangle approximation read as a solid star at badge size.
 *
 * The white disc is what makes it legible on card art, which runs from
 * near-white title bands to dark illustration.
 *
 * The Konva canvas cannot mount this component; the on-card badge draws the
 * same disc-plus-image with Konva primitives from STAR_OF_DAVID_IMG below, so
 * both surfaces share one asset.
 */

/** Public path of the hexagram asset — shared with the Konva on-card badge. */
export const STAR_OF_DAVID_IMG = '/gameplay/star_of_david.webp';

/** Hexagram width as a fraction of the disc diameter, both surfaces. */
export const STAR_OF_DAVID_INSET = 0.72;

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
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: '#ffffff',
        flexShrink: 0,
        verticalAlign: 'text-bottom',
        ...style,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={STAR_OF_DAVID_IMG}
        alt=""
        width={Math.round(size * STAR_OF_DAVID_INSET)}
        height={Math.round(size * STAR_OF_DAVID_INSET)}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    </span>
  );
}
