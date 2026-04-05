'use client';

import { useRef, useMemo, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { GameProvider } from '../state/GameContext';
import { CardPreviewProvider } from '../state/CardPreviewContext';
import { LoadingScreen } from '../components/LoadingScreen';
import { CardLoupePanel } from '../components/CardLoupePanel';
import { useImagePreloader } from '../hooks/useImagePreloader';
import type { DeckDataForGoldfish } from '../types';
import { getCardImageUrl } from '../../shared/utils/cardImageUrl';
import { useVirtualCanvas } from '@/app/shared/layout/virtualCanvas';

const GoldfishCanvas = dynamic(() => import('../components/GoldfishCanvas'), { ssr: false });

interface GoldfishClientProps {
  deck: DeckDataForGoldfish;
}

function GoldfishGameArea({ deck }: { deck: DeckDataForGoldfish }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef);

  // Collect all unique image URLs to preload
  const imageUrls = useMemo(() => {
    const urls = new Set<string>();
    for (const c of deck.cards) {
      if (c.card_img_file) {
        urls.add(getCardImageUrl(c.card_img_file));
      }
    }
    return Array.from(urls);
  }, [deck.cards]);

  const { isReady, progress } = useImagePreloader(imageUrls);

  if (!isReady) {
    return <LoadingScreen progress={progress} />;
  }

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#0d0905',
        cursor: 'default',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      {/* Cave background image — shared across game area and loupe */}
      <div
        className="cave-bg"
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

      {/* Torch glow + vignette overlays */}
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

      {/* Game area container — ref measures available space after loupe */}
      <div ref={containerRef} style={{ position: 'relative', flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
        {containerWidth > 0 && containerHeight > 0 && (
          <GoldfishCanvas
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            virtualWidth={virtualWidth}
          />
        )}
      </div>

      {/* Loupe preview panel — right side */}
      <CardLoupePanel />
    </div>
  );
}

export default function GoldfishClient({ deck }: GoldfishClientProps) {
  useEffect(() => {
    localStorage.setItem('lastPlayedDeckId', deck.id);
  }, [deck.id]);

  return (
    <CardPreviewProvider>
      <GameProvider deck={deck}>
        <GoldfishGameArea deck={deck} />
      </GameProvider>
    </CardPreviewProvider>
  );
}
