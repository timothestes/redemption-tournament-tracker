'use client';

import { useRef } from 'react';
import dynamic from 'next/dynamic';
import { CardPreviewProvider } from '@/app/goldfish/state/CardPreviewContext';
import { GameProvider } from '@/app/goldfish/state/GameContext';
import { CardLoupePanel } from '@/app/goldfish/components/CardLoupePanel';
import type { DeckDataForGoldfish } from '@/app/goldfish/types';
import { useVirtualCanvas } from '@/app/shared/layout/virtualCanvas';

const DynamicGoldfishCanvas = dynamic(
  () => import('@/app/goldfish/components/GoldfishCanvas'),
  { ssr: false },
);

export const BANNER_HEIGHT = 48;

interface WaitingRoomGoldfishProps {
  deck: DeckDataForGoldfish;
}

function GoldfishArea() {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `calc(100vh - ${BANNER_HEIGHT}px)`,
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
      <div ref={containerRef} style={{ position: 'relative', flex: 1, height: '100%' }}>
        {containerWidth > 0 && containerHeight > 0 && (
          <DynamicGoldfishCanvas
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            virtualWidth={virtualWidth}
          />
        )}
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
