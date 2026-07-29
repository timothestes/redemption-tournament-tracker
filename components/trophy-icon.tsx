/**
 * Podium trophy — gold / silver / bronze. Renders nothing outside the top 3.
 * Shared by the community deck grid and the public tournament standings so the
 * two surfaces stay visually identical.
 */
export function TrophyIcon({ place, className }: { place: number; className?: string }) {
  const colors = place === 1
    ? { fill: "#FFD700", stroke: "#B8860B" }
    : place === 2
      ? { fill: "#C0C0C0", stroke: "#808080" }
      : place === 3
        ? { fill: "#CD7F32", stroke: "#8B5A2B" }
        : null;

  if (!colors) return null;

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Cup bowl */}
      <path d="M7 3h10v5c0 2.76-2.24 5-5 5s-5-2.24-5-5V3z" fill={colors.fill} stroke={colors.stroke} strokeWidth="1.2"/>
      {/* Left handle */}
      <path d="M7 5H5.5C4.12 5 3 6.12 3 7.5S4.12 10 5.5 10H7" stroke={colors.stroke} strokeWidth="1.2" fill="none"/>
      {/* Right handle */}
      <path d="M17 5h1.5C19.88 5 21 6.12 21 7.5S19.88 10 18.5 10H17" stroke={colors.stroke} strokeWidth="1.2" fill="none"/>
      {/* Stem */}
      <path d="M11 13h2v4h-2z" fill={colors.stroke}/>
      {/* Base */}
      <path d="M8 17h8v1.5a1 1 0 01-1 1H9a1 1 0 01-1-1V17z" fill={colors.fill} stroke={colors.stroke} strokeWidth="1"/>
      {/* Base plate */}
      <rect x="7" y="20" width="10" height="1.5" rx="0.5" fill={colors.stroke}/>
    </svg>
  );
}
