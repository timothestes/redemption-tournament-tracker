'use client';

import { useState, useRef, useMemo, useCallback } from 'react';
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

  // Dimension simulation for testing different aspect ratios
  const [simulated, setSimulated] = useState<{ width: number; height: number; label: string } | null>(null);
  const simulatedSize = simulated ? { width: simulated.width, height: simulated.height } : null;

  const { scale, offsetX, offsetY, containerWidth, containerHeight, virtualWidth } = useVirtualCanvas(containerRef, simulatedSize);

  const onSimulateDimensions = useCallback((width: number, height: number) => {
    // Find the label from the preset
    const presets = [
      { label: '4:3 (1440x1080)', width: 1440, height: 1080 },
      { label: '16:10 (1680x1050)', width: 1680, height: 1050 },
      { label: '16:9 (1920x1080)', width: 1920, height: 1080 },
      { label: '21:9 Ultrawide (2560x1080)', width: 2560, height: 1080 },
      { label: '32:9 Super UW (3440x1080)', width: 3440, height: 1080 },
      { label: 'iPad (1024x768)', width: 1024, height: 768 },
    ];
    const match = presets.find(p => p.width === width && p.height === height);
    setSimulated({ width, height, label: match?.label ?? `${width}x${height}` });
  }, []);

  const onClearSimulation = useCallback(() => setSimulated(null), []);

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
      <div ref={containerRef} style={{ position: 'relative', flex: 1, height: '100%' }}>
        {containerWidth > 0 && containerHeight > 0 && (
          <GoldfishCanvas
            containerWidth={containerWidth}
            containerHeight={containerHeight}
            scale={scale}
            offsetX={offsetX}
            offsetY={offsetY}
            virtualWidth={virtualWidth}
            onSimulateDimensions={onSimulateDimensions}
            onClearSimulation={onClearSimulation}
            simulatedLabel={simulated?.label ?? null}
          />
        )}
      </div>

      {/* Loupe preview panel — right side */}
      <CardLoupePanel />
    </div>
  );
}

export default function GoldfishClient({ deck }: GoldfishClientProps) {
  return (
    <CardPreviewProvider>
      <GameProvider deck={deck}>
        <GoldfishGameArea deck={deck} />
      </GameProvider>
    </CardPreviewProvider>
  );
}
