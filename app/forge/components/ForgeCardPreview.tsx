"use client";

import { useId, type CSSProperties } from "react";
import type { DesignCard, StatValue } from "@/app/forge/lib/designCard";
import { cardRawText } from "@/app/forge/lib/designCard";
import {
  washPaths, iconBox, classIcons, gradientRows, isPreviewApproximate, type IconBox,
} from "@/app/forge/lib/frameAssets";
import { CANVAS, RECTS, GRADIENT_ROWS, BORDER_STROKE } from "@/app/forge/lib/frameGeometry";

// Rough rendered card: the design team's frame (washes / icons / badges from the kit,
// chrome drawn as SVG from the template's geometry) around the live DesignCard. It is a
// draft for designers, not the print graphic — see the 2026-09-09 live-preview spec.
//
// Coordinates: everything is laid out in the 750x1050 canvas from frameGeometry and
// converted to container units, so the preview scales with its width. Plain <img> only
// (never next/image — the forge-no-next-image guardrail; art stays on the authed proxy).

const { w: CW, h: CH } = CANVAS;
const INK = "#231f20"; // the template's 100% K through its SWOP profile
const COPYRIGHT_YEAR = new Date().getFullYear();
const TITLE_FONT = "ForgeTitle, 'Trebuchet MS', 'Segoe UI', sans-serif";
const STAT_FONT = "ForgeStat, Georgia, 'Times New Roman', serif";
// ForgeTitle (Mukta ExtraBold) averages ~0.55em per character; used to size and squeeze titles.
// Sizes are cap heights measured off printed cards (title ~26 px, stats ~22 px on the canvas).
const TITLE_EM = 0.55;
const TITLE_MAX = 40, TITLE_MIN = 28;

type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r?: number };

const cqw = (px: number) => `${(px / CW) * 100}cqw`;
const pctX = (px: number) => `${(px / CW) * 100}%`;
const pctY = (px: number) => `${(px / CH) * 100}%`;
const place = (r: Rect): CSSProperties => ({
  position: "absolute", left: pctX(r.x), top: pctY(r.y), width: pctX(r.w), height: pctY(r.h),
});

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" loading="lazy" decoding="async" {...p} />;

function statText(s: StatValue | undefined, t: StatValue | undefined): string {
  const f = (v: StatValue | undefined) => (v === null || v === undefined || v === "" ? "?" : String(v));
  return `${f(s)}/${f(t)}`;
}

// Icon box: a rounded tab in the frame corner, drawn over the border the way printed boxes
// are (they overhang it by a hair). The outer corner follows the card corner; the other
// three are tighter. Fill is the brigade color (split into a top/bottom band for two
// brigades) or a badge; stats sit in the top band, the type icon at the template's slot.
const BOX_R = 22, BOX_OUTER_R = 42;
function tabPath({ x, y, w, h }: Rect, side: "left" | "right"): string {
  const [tl, tr] = side === "left" ? [BOX_OUTER_R, BOX_R] : [BOX_R, BOX_OUTER_R];
  const r = BOX_R;
  return `M${x + tl} ${y}H${x + w - tr}A${tr} ${tr} 0 0 1 ${x + w} ${y + tr}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`
    + `H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + tl}A${tl} ${tl} 0 0 1 ${x + tl} ${y}Z`;
}

function IconBoxG({ id, box, rect, side, stat }: {
  id: string; box: IconBox; rect: Rect; side: "left" | "right"; stat: string | null;
}) {
  const { x, y, w, h } = rect;
  const d = tabPath(rect, side);
  const split = y + h * 0.45;
  const statSize = stat && stat.length > 7 ? 23 : stat && stat.length > 4 ? 28 : 34;
  return (
    <g>
      <clipPath id={id}><path d={d} /></clipPath>
      <path d={d} fill={box.fill} />
      {box.fill2 && <rect x={x} y={split} width={w} height={y + h - split} fill={box.fill2} clipPath={`url(#${id})`} />}
      {box.badge && (
        <image href={box.badge} x={x} y={y} width={w} height={h} preserveAspectRatio={`${box.badgeAlign} slice`} clipPath={`url(#${id})`} />
      )}
      {box.icon && box.iconRect && (
        <image href={box.icon} x={box.iconRect.x} y={box.iconRect.y} width={box.iconRect.w} height={box.iconRect.h} preserveAspectRatio="xMidYMid meet" />
      )}
      <path d={d} fill="none" stroke={INK} strokeWidth={4} />
      {stat && (
        <text
          x={x + w / 2 + (side === "left" ? 4 : -4)} y={y + 43} textAnchor="middle"
          fontFamily={STAT_FONT} fontSize={statSize}
          fill={box.darkText ? INK : "#fff"} stroke={box.darkText ? "#fff" : INK} strokeWidth={2.6}
          paintOrder="stroke" style={{ paintOrder: "stroke" }}
        >
          {stat}
        </text>
      )}
    </g>
  );
}

export default function ForgeCardPreview({
  card, artUrl, className,
}: { card: DesignCard; artUrl?: string | null; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const washes = washPaths(card);
  const left = iconBox(card, "left");
  const right = iconBox(card, "right");
  const classes = classIcons(card);
  const rows = gradientRows(card);
  const { light, dark } = GRADIENT_ROWS[rows];
  const approximate = isPreviewApproximate(card);

  const B = RECTS.border, A = RECTS.art, T = RECTS.textBox, I = RECTS.textInset;
  const name = card.name?.trim() || "Card Name";
  // Title: right-aligned, or centered between the boxes when there is a right box (as
  // printed Covenants / Curses are). Shrinks for long names, then squeezes the glyphs the
  // way printed cards condense long titles.
  const titleLeft = RECTS.title.x;
  const titleRight = right ? RECTS.rightBox.x - 12 : titleLeft + RECTS.title.w;
  const titleAvail = titleRight - titleLeft;
  const titleWidth = (size: number) => name.length * size * TITLE_EM;
  const titleSize = titleWidth(TITLE_MAX) > titleAvail ? Math.max(TITLE_MIN, (TITLE_MAX * titleAvail) / titleWidth(TITLE_MAX)) : TITLE_MAX;
  const titleSqueeze = titleWidth(titleSize) > titleAvail;
  const ability = cardRawText(card).trim();
  const abilitySize = Math.max(19, Math.min(27, 27 - Math.max(0, ability.length - 110) * 0.03));
  const abilityBottom = T.y + (T.h * light) / 100 - 6;
  const scriptureTop = T.y + (T.h * dark) / 100 - 3;
  const ids = card.identifiers ?? [];
  const stat = left?.withStats ? statText(card.strength, card.toughness) : null;

  return (
    <div
      className={className}
      role="img"
      aria-label={card.name ? `Card preview: ${card.name}` : "Card preview"}
      style={{
        position: "relative", aspectRatio: `${CW} / ${CH}`, width: "100%", containerType: "inline-size",
        overflow: "hidden", borderRadius: "3.73% / 2.67%", background: "#fff", color: INK,
        fontFamily: "ForgeBody, system-ui, sans-serif", userSelect: "none",
      }}
    >
      {/* 1. wash(es) inside the border rect; a second brigade blends in from the bottom,
            matching the split of the icon box */}
      {washes.length === 0 && <div style={{ ...place(B), borderRadius: cqw(B.r ?? 0), background: "#b9b3aa" }} />}
      {washes.map((src, i) => (
        <Img key={src} src={src} style={{
          ...place(B), borderRadius: cqw(B.r ?? 0), objectFit: "cover",
          ...(i === 1 ? { WebkitMaskImage: "linear-gradient(to bottom, transparent 40%, #000 60%)", maskImage: "linear-gradient(to bottom, transparent 40%, #000 60%)" } : {}),
        }} />
      ))}

      {/* 2. art window: uploaded art clipped to the window, or the template's empty white slot */}
      <div style={{ ...place(A), borderRadius: cqw(A.r ?? 0), overflow: "hidden", background: "#fff" }}>
        {artUrl ? (
          <Img src={artUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#a9adc9", fontSize: cqw(26), letterSpacing: "0.14em", textAlign: "center", lineHeight: 1.4 }}>
            NO ART
          </div>
        )}
      </div>

      {/* 3. chrome: text box, window outline, frame border, then the icon boxes and class
            icons over it (as printed), and the title */}
      <svg viewBox={`0 0 ${CW} ${CH}`} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}>
        <defs>
          <linearGradient id={`${uid}g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.8" />
            <stop offset={light / 100} stopColor="#fff" stopOpacity="0.8" />
            <stop offset={dark / 100} stopColor={INK} stopOpacity="1" />
            <stop offset="1" stopColor={INK} stopOpacity="1" />
          </linearGradient>
        </defs>
        <rect x={T.x} y={T.y} width={T.w} height={T.h} rx={T.r} fill={`url(#${uid}g)`} stroke={INK} strokeWidth={2.5} />
        <rect x={A.x} y={A.y} width={A.w} height={A.h} rx={A.r} fill="none" stroke={INK} strokeWidth={4} />
        <rect x={B.x} y={B.y} width={B.w} height={B.h} rx={B.r} fill="none" stroke={INK} strokeWidth={BORDER_STROKE} />
        {left && <IconBoxG id={`${uid}l`} box={left} rect={RECTS.leftBox} side="left" stat={stat} />}
        {right && <IconBoxG id={`${uid}r`} box={right} rect={RECTS.rightBox} side="right" stat={null} />}
        {classes.map((c) => (
          <image key={c.src} href={c.src} x={c.rect.x} y={c.rect.y} width={c.rect.w} height={c.rect.h} preserveAspectRatio="xMidYMid meet" />
        ))}
        <clipPath id={`${uid}t`}><rect x={titleLeft} y={RECTS.title.y - 12} width={titleAvail} height={RECTS.title.h + 24} /></clipPath>
        <text
          x={right ? (titleLeft + titleRight) / 2 : titleRight} y={RECTS.title.y + 42} textAnchor={right ? "middle" : "end"}
          clipPath={`url(#${uid}t)`} fontFamily={TITLE_FONT} fontSize={titleSize}
          fill="#fff" stroke={INK} strokeWidth={2.8} paintOrder="stroke" style={{ paintOrder: "stroke" }}
          {...(titleSqueeze ? { textLength: titleAvail, lengthAdjust: "spacingAndGlyphs" as const } : {})}
        >
          {name}
        </text>
      </svg>

      {/* 4. identifier bubble — straddles the art window and the text box */}
      {ids.length > 0 && (
        <div style={{ ...place(RECTS.idBubble), display: "flex", justifyContent: "center", alignItems: "stretch" }}>
          <span style={{
            maxWidth: "100%", boxSizing: "border-box", display: "inline-flex", alignItems: "center", padding: `0 ${cqw(16)}`,
            borderRadius: "9999px", background: "rgba(0,0,0,0.75)", border: `${cqw(1.5)} solid ${INK}`,
            color: "#fff", fontWeight: 700, fontSize: cqw(19), lineHeight: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {ids.join(", ")}
          </span>
        </div>
      )}

      {/* 5. ability text on the light part of the box */}
      <div style={{
        position: "absolute", left: pctX(I.x), top: pctY(I.y), width: pctX(I.w), height: pctY(abilityBottom - I.y),
        display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", overflow: "hidden",
        fontWeight: 700, fontSize: cqw(abilitySize), lineHeight: 1.15, whiteSpace: "pre-wrap", padding: `0 ${cqw(4)}`, boxSizing: "border-box",
      }}>
        {ability}
      </div>

      {/* 6. scripture + reference on the dark part */}
      <div style={{
        position: "absolute", left: pctX(I.x), top: pctY(scriptureTop), width: pctX(I.w), height: pctY(I.y + I.h - scriptureTop),
        display: "flex", flexDirection: "column", justifyContent: "space-between", overflow: "hidden", color: "#f2efe4",
        fontSize: cqw(18), lineHeight: 1.12, padding: `0 ${cqw(4)}`, boxSizing: "border-box",
      }}>
        <span style={{ fontStyle: "italic", overflow: "hidden" }}>{card.scripture ?? ""}</span>
        <span style={{ textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{card.reference ?? ""}</span>
      </div>

      {/* 7. credits */}
      <div style={{
        ...place(RECTS.credits), display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "flex-end",
        color: "#fff", fontWeight: 700, lineHeight: 1.3, textShadow: `0 ${cqw(1)} ${cqw(2)} rgba(0,0,0,.8)`, whiteSpace: "nowrap",
      }}>
        <span style={{ fontSize: cqw(15), overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
          Illus. {card.artistCredit?.trim() || "Artist Unknown"}
        </span>
        <span style={{ fontSize: cqw(13) }}>© {COPYRIGHT_YEAR} Cactus Game Design, Inc.</span>
      </div>

      {approximate && (
        <div style={{ position: "absolute", left: "50%", bottom: "1.2%", transform: "translateX(-50%)", background: "rgba(0,0,0,.7)", color: "#fff", fontSize: cqw(16), padding: `${cqw(2)} ${cqw(8)}`, borderRadius: cqw(6), whiteSpace: "nowrap" }}>
          preview approximate
        </div>
      )}
    </div>
  );
}
