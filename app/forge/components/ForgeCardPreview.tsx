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
  title:     { left: "28%", top: "3.5%", width: "68%", height: "8%" },
  ability:   { left: "9%", top: "64%", width: "82%", height: "16%" },
  scripture: { left: "9%", top: "80%", width: "82%", height: "12%" },
  footer:    { left: "9%", top: "93%", width: "82%", height: "5%" },
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
      style={{ position: "relative", aspectRatio: "750 / 1050", width: "100%", fontFamily: "ForgeBody, system-ui, sans-serif" }}
    >
      {/* 1. white base */}
      <Img src="/forge/frames/Elements/White Border.png" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }} />
      {/* 2. brigade wash (image) or solid-color fallback */}
      {wash ? (
        <Img src={wash} style={{ ...abs(G.wash), zIndex: 1, objectFit: "cover", borderRadius: "5%" }} />
      ) : (
        <div style={{ ...abs(G.wash), zIndex: 1, background: fallbackColor, borderRadius: "5%" }} />
      )}
      {/* 3. art */}
      {artUrl && <Img src={artUrl} style={{ ...abs(G.art), zIndex: 2, objectFit: "cover" }} />}
      {/* 4. art frame */}
      <Img src="/forge/frames/Elements/Art Box.png" style={{ ...abs(G.art), zIndex: 3, width: G.art.width, height: G.art.height }} />
      {/* 5. stat box (stat-bearing types) */}
      {isStatBearing(types) && (
        <div style={{ ...abs(G.statBox), zIndex: 4, background: statBox ? undefined : fallbackColor, borderRadius: "10%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700 }}>
          {statBox && <Img src={statBox} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />}
          <span style={{ position: "relative", fontSize: "clamp(10px, 4vw, 28px)" }}>
            {card.strength ?? 0}/{card.toughness ?? 0}
          </span>
          {icon && <Img src={icon} style={{ position: "relative", height: "40%", marginTop: "2%" }} />}
        </div>
      )}
      {/* 6. title */}
      <div style={{ ...abs(G.title), zIndex: 5, display: "flex", alignItems: "center", justifyContent: "flex-end", color: "#fff", fontFamily: "ForgeTitle, ForgeBody, sans-serif", fontSize: "clamp(12px, 5vw, 34px)", textShadow: "0 1px 2px rgba(0,0,0,.6)" }}>
        {card.name || "Card Title"}
      </div>
      {/* 8. ability */}
      <div style={{ ...abs(G.ability), zIndex: 5, overflow: "hidden", color: "#111", fontWeight: 700, textAlign: "center", fontSize: "clamp(8px, 2.6vw, 16px)", lineHeight: 1.15, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {card.specialAbility || ""}
      </div>
      {/* scripture + reference */}
      <div style={{ ...abs(G.scripture), zIndex: 5, overflow: "hidden", color: "#eee", fontStyle: "italic", fontSize: "clamp(7px, 2.2vw, 13px)", lineHeight: 1.15 }}>
        {card.flavorText || ""}
        <div style={{ textAlign: "right", fontStyle: "normal", fontWeight: 700 }}>{card.reference || ""}</div>
      </div>
      {/* footer */}
      <div style={{ ...abs(G.footer), zIndex: 5, display: "flex", justifyContent: "space-between", alignItems: "flex-end", color: "#fff", fontSize: "clamp(6px, 1.6vw, 10px)", opacity: 0.85 }}>
        <span>{card.artistCredit ? `Illus. ${card.artistCredit}` : "Illus. Artist Unknown"}</span>
        <span>© Cactus Game Design, Inc.</span>
      </div>
      {/* approximate badge */}
      {approximate && (
        <div style={{ position: "absolute", left: "50%", bottom: "1%", transform: "translateX(-50%)", zIndex: 6, background: "rgba(0,0,0,.7)", color: "#fff", fontSize: "9px", padding: "1px 6px", borderRadius: "4px" }}>
          preview approximate
        </div>
      )}
    </div>
  );
}
