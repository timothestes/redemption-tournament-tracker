'use client';

import { Group, Rect, Line, Text } from 'react-konva';
import type { ZoneRect } from '../layout/multiplayerLayout';

interface BattleZoneLayerProps {
  zone: ZoneRect;
  cardWidth: number;
  cardHeight: number;
  playerCardCount: number;
  opponentCardCount: number;
}

/**
 * Renders the Field of Battle zone visual treatment:
 * - Warm amber background with radial glow
 * - Central clash line
 * - Drop guide silhouettes when empty
 */
export function BattleZoneLayer({
  zone,
  cardWidth,
  cardHeight,
  playerCardCount,
  opponentCardCount,
}: BattleZoneLayerProps) {
  const midY = zone.y + zone.height / 2;
  const halfHeight = zone.height / 2;

  const guideCenterX = zone.x + zone.width / 2 - cardWidth / 2;
  const playerGuideY = zone.y + halfHeight + (halfHeight - cardHeight) / 2;
  const opponentGuideY = zone.y + (halfHeight - cardHeight) / 2;

  return (
    <Group>
      {/* Battle zone background — warm amber glow */}
      <Rect
        x={zone.x}
        y={zone.y}
        width={zone.width}
        height={zone.height}
        fill="#1e1610"
        opacity={0.55}
        cornerRadius={3}
      />

      {/* Radial glow effect at center */}
      <Rect
        x={zone.x + zone.width * 0.2}
        y={midY - zone.height * 0.3}
        width={zone.width * 0.6}
        height={zone.height * 0.6}
        fillRadialGradientStartPoint={{ x: zone.width * 0.3, y: zone.height * 0.3 }}
        fillRadialGradientEndPoint={{ x: zone.width * 0.3, y: zone.height * 0.3 }}
        fillRadialGradientStartRadius={0}
        fillRadialGradientEndRadius={zone.width * 0.3}
        fillRadialGradientColorStops={[0, 'rgba(241, 189, 126, 0.12)', 1, 'rgba(241, 189, 126, 0)']}
        listening={false}
      />

      {/* Clash line — horizontal dashed line at center */}
      <Line
        points={[zone.x + 40, midY, zone.x + zone.width - 40, midY]}
        stroke="#F1BD7E"
        strokeWidth={1}
        opacity={0.3}
        dash={[8, 6]}
        listening={false}
      />

      {/* Drop guide — Player side (hero placeholder) */}
      {playerCardCount === 0 && (
        <Group>
          <Rect
            x={guideCenterX}
            y={playerGuideY}
            width={cardWidth}
            height={cardHeight}
            stroke="#F1BD7E"
            strokeWidth={1}
            dash={[6, 4]}
            opacity={0.25}
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={guideCenterX}
            y={playerGuideY + cardHeight / 2 - 6}
            width={cardWidth}
            text="HERO"
            fontSize={10}
            fontFamily="Cinzel, Georgia, serif"
            fill="#F1BD7E"
            opacity={0.35}
            align="center"
            listening={false}
          />
        </Group>
      )}

      {/* Drop guide — Opponent side (blocker placeholder) */}
      {opponentCardCount === 0 && (
        <Group>
          <Rect
            x={guideCenterX}
            y={opponentGuideY}
            width={cardWidth}
            height={cardHeight}
            stroke="#F1BD7E"
            strokeWidth={1}
            dash={[6, 4]}
            opacity={0.25}
            cornerRadius={3}
            listening={false}
          />
          <Text
            x={guideCenterX}
            y={opponentGuideY + cardHeight / 2 - 6}
            width={cardWidth}
            text="BLOCKER"
            fontSize={10}
            fontFamily="Cinzel, Georgia, serif"
            fill="#F1BD7E"
            opacity={0.35}
            align="center"
            listening={false}
          />
        </Group>
      )}
    </Group>
  );
}
