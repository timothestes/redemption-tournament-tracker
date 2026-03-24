'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { CardPreviewProvider, useCardPreview } from '@/app/goldfish/state/CardPreviewContext';
import { GameProvider } from '@/app/goldfish/state/GameContext';
import { CardLoupePanel, LOUPE_PANEL_WIDTH, LOUPE_COLLAPSED_WIDTH } from '@/app/goldfish/components/CardLoupePanel';
import type { DeckDataForGoldfish } from '@/app/goldfish/types';

const DynamicGoldfishCanvas = dynamic(
  () => import('@/app/goldfish/components/GoldfishCanvas'),
  { ssr: false },
);

export const BANNER_HEIGHT = 48;

// Match the original goldfish aspect ratio cap
const MAX_ASPECT_RATIO = 2.0;

function getEffectiveDimensions(viewportWidth: number, viewportHeight: number, loupeWidth: number) {
  const availableWidth = viewportWidth - loupeWidth;
  const ar = availableWidth / viewportHeight;
  const effectiveWidth = ar > MAX_ASPECT_RATIO
    ? Math.round(viewportHeight * MAX_ASPECT_RATIO)
    : availableWidth;
  return { width: effectiveWidth, height: viewportHeight };
}

interface WaitingRoomGoldfishProps {
  deck: DeckDataForGoldfish;
}

function GoldfishArea() {
  const { isLoupeVisible } = useCardPreview();

  const [viewport, setViewport] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    function update() {
      setViewport({ width: window.innerWidth, height: window.innerHeight - BANNER_HEIGHT });
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  if (!viewport) return null;

  const loupeWidth = isLoupeVisible ? LOUPE_PANEL_WIDTH : LOUPE_COLLAPSED_WIDTH;
  const dimensions = getEffectiveDimensions(viewport.width, viewport.height, loupeWidth);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: viewport.height,
        overflow: 'hidden',
        background: '#0d0905',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* Cave background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'url(/gameplay/cave_background.png)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 70%',
          backgroundRepeat: 'no-repeat',
          pointerEvents: 'none',
        }}
      />

      {/* Vignette overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `
            radial-gradient(ellipse 60% 50% at 50% 30%, rgba(180,120,40,0.06) 0%, transparent 70%),
            radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.75) 100%)
          `,
        }}
      />

      {/* Game area */}
      <div style={{ position: 'relative', flex: 1, height: '100%' }}>
        <div style={{ position: 'relative', width: dimensions.width, height: '100%', margin: '0 auto' }}>
          <DynamicGoldfishCanvas width={dimensions.width} height={dimensions.height} />
        </div>
      </div>

      {/* Card preview panel */}
      <CardLoupePanel />
    </div>
  );
}

export default function WaitingRoomGoldfish({ deck }: WaitingRoomGoldfishProps) {
  return (
    <CardPreviewProvider>
      <GameProvider deck={deck}>
        <GoldfishArea />
      </GameProvider>
    </CardPreviewProvider>
  );
}
