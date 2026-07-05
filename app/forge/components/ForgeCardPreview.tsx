"use client";

import type { DesignCard } from "@/app/forge/lib/designCard";
import { isStatBearing } from "@/app/forge/lib/designCard";
import { washPath, statBoxPath, iconPath, isPreviewApproximate, BRIGADE_HEX } from "@/app/forge/lib/frameAssets";

// Slot geometry as % of the 750×1050 canvas. STARTING VALUES — tune visually
// against public/forge/frames/Complete Cards/ references.
const G = {
  wash:      { left: "4.8%", top: "3.5%", width: "90.4%", height: "93%" },
  art:       { left: "8.5%", top: "13%", width: "83%", height: "49%" },
  statBox:   { left: "4%", top: "3%", width: "22%", height: "11%" },
  typeIcon:  { left: "4.8%", top: "3.5%", width: "12%", height: "9%" },
  title:     { left: "28%", top: "3.5%", width: "68%", height: "8%" },
  identifier:{ left: "9%", top: "60.5%", width: "82%", height: "2.8%" },
  ability:   { left: "9%", top: "64%", width: "82%", height: "16%" },
  scripture: { left: "9%", top: "80%", width: "82%", height: "12%" },
  footer:    { left: "9%", top: "92%", width: "82%", height: "4%" },
} as const;

// eslint-disable-next-line @next/next/no-img-element
const Img = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt="" {...p} />;

export default function ForgeCardPreview({
  card, artUrl, className,
}: { card: DesignCard; artUrl?: string | null; className?: string }) {
  const types = card.cardType ?? [];
  const wash = washPath(card);
  const firstBrigade = (card.brigades ?? [])[0];
  const fallbackColor = firstBrigade ? BRIGADE_HEX[firstBrigade] : "#cfcfcf";
  const statBox = statBoxPath(card);
  const icon = iconPath(card);
  const approximate = isPreviewApproximate(card);

  const abs = (g: { left: string; top: string; width: string; height: string }) =>
    ({ position: "absolute" as const, ...g });

  return (
    <div
      className={className}
      style={{ position: "relative", aspectRatio: "750 / 1050", width: "100%", containerType: "inline-size", fontFamily: "ForgeBody, system-ui, sans-serif" }}
    >
      {/* 1. white base */}
      <Img src="/forge/frames/Elements/White Border.webp" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />
      {/* 2. brigade wash (image) or solid-color fallback */}
      {wash ? (
        <Img src={wash} style={{ ...abs(G.wash), zIndex: 1, objectFit: "cover", borderRadius: "5%" }} />
      ) : (
        <div style={{ ...abs(G.wash), zIndex: 1, background: fallbackColor, borderRadius: "5%" }} />
      )}
      {/* 3. art window — uploaded art clipped to the window, or a clean empty slot.
            (The kit's "Art Box" element is a checkerboard placeholder, not a frame,
            so we draw the window border in CSS instead.) */}
      <div style={{ ...abs(G.art), zIndex: 2, borderRadius: "2.5%", overflow: "hidden", border: "1.5px solid rgba(0,0,0,0.5)", background: "rgba(0,0,0,0.18)" }}>
        {artUrl ? (
          <Img src={artUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.45)", fontSize: "3.4cqw" }}>
            No art
          </div>
        )}
      </div>
      {/* 5. stat box (stat-bearing types) — solid brigade color (kit has no single Color element) */}
      {isStatBearing(types) && (
        <div style={{ ...abs(G.statBox), zIndex: 4, background: statBox ? undefined : fallbackColor, borderRadius: "10%", border: "1px solid rgba(255,255,255,0.35)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700 }}>
          {statBox && <Img src={statBox} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
          <span style={{ position: "relative", fontSize: "7cqw", lineHeight: 1, textShadow: "0 1px 2px rgba(0,0,0,.7)" }}>
            {card.strength ?? 0}/{card.toughness ?? 0}
          </span>
          {icon && <Img src={icon} style={{ position: "relative", height: "42%", marginTop: "3%", objectFit: "contain" }} />}
        </div>
      )}
      {/* 5b. corner type-icon box (non-stat-bearing types) — identifies the card type */}
      {!isStatBearing(types) && icon && (
        <div style={{ ...abs(G.typeIcon), zIndex: 4, background: fallbackColor, borderRadius: "12%", border: "1px solid rgba(255,255,255,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Img src={icon} style={{ height: "72%", objectFit: "contain" }} />
        </div>
      )}
      {/* 6. title */}
      <div style={{ ...abs(G.title), zIndex: 5, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", color: "#fff", fontFamily: "ForgeTitle, ForgeBody, sans-serif", fontSize: "6.5cqw", lineHeight: 1.02, textShadow: "0 1px 2px rgba(0,0,0,.7)", overflow: "hidden" }}>
        {card.name || "Card Title"}
      </div>
      {/* 6b. identifier pills — single clipped row above the ability panel */}
      {(card.identifiers ?? []).length > 0 && (
        <div style={{ ...abs(G.identifier), zIndex: 5, display: "flex", flexWrap: "nowrap", gap: "1cqw", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
          {(card.identifiers ?? []).map((id) => (
            <span key={id} style={{ borderRadius: "9999px", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "2.8cqw", padding: "0.4cqw 1.6cqw", whiteSpace: "nowrap" }}>
              {id}
            </span>
          ))}
        </div>
      )}
      {/* 7. ability — light panel so dark text stays readable on any wash */}
      <div style={{ ...abs(G.ability), zIndex: 5, overflow: "hidden", boxSizing: "border-box", background: "rgba(245,241,233,0.96)", borderRadius: "2.5%", padding: "1.4cqw 3cqw", color: "#111", fontWeight: 700, textAlign: "center", fontSize: "4cqw", lineHeight: 1.15, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {card.specialAbility || ""}
      </div>
      {/* 8. scripture + reference — dark panel, light italic text */}
      <div style={{ ...abs(G.scripture), zIndex: 5, overflow: "hidden", boxSizing: "border-box", background: "rgba(0,0,0,0.82)", borderRadius: "2.5%", padding: "1.4cqw 3cqw", color: "#e8e8e8", fontStyle: "italic", fontSize: "3.2cqw", lineHeight: 1.15, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <span style={{ overflow: "hidden" }}>{card.scripture || ""}</span>
        <span style={{ textAlign: "right", fontStyle: "normal", fontWeight: 700 }}>{card.reference || ""}</span>
      </div>
      {/* 9. footer */}
      <div style={{ ...abs(G.footer), zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "center", gap: "2cqw", color: "#fff", fontSize: "2.6cqw", opacity: 0.95, textShadow: "0 1px 2px rgba(0,0,0,.85)" }}>
        <span style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{card.artistCredit ? `Illus. ${card.artistCredit}` : "Illus. Artist Unknown"}</span>
        <span style={{ whiteSpace: "nowrap" }}>© Cactus Game Design, Inc.</span>
      </div>
      {/* approximate badge */}
      {approximate && (
        <div style={{ position: "absolute", left: "50%", bottom: "1%", transform: "translateX(-50%)", zIndex: 6, background: "rgba(0,0,0,.7)", color: "#fff", fontSize: "2.6cqw", padding: "1px 6px", borderRadius: "4px" }}>
          preview approximate
        </div>
      )}
    </div>
  );
}
