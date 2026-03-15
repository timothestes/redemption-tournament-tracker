'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { GameProvider } from '../state/GameContext';
import { CardPreviewProvider, useCardPreview } from '../state/CardPreviewContext';
import { LoadingScreen } from '../components/LoadingScreen';
import { CardLoupePanel, LOUPE_PANEL_WIDTH, LOUPE_COLLAPSED_WIDTH } from '../components/CardLoupePanel';
import { useImagePreloader } from '../hooks/useImagePreloader';
import type { DeckDataForGoldfish } from '../types';

const GoldfishCanvas = dynamic(() => import('../components/GoldfishCanvas'), { ssr: false });

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (imgFile.startsWith('/')) return imgFile;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

interface GoldfishClientProps {
  deck: DeckDataForGoldfish;
}

// Cap the game area width so the layout doesn't break on ultrawide monitors.
// Beyond this ratio, the extra width becomes visible cave background.
const MAX_ASPECT_RATIO = 2.0;

function getEffectiveDimensions(viewportWidth: number, viewportHeight: number, loupeWidth: number) {
  const availableWidth = viewportWidth - loupeWidth;
  const ar = availableWidth / viewportHeight;
  const effectiveWidth = ar > MAX_ASPECT_RATIO
    ? Math.round(viewportHeight * MAX_ASPECT_RATIO)
    : availableWidth;
  return { width: effectiveWidth, height: viewportHeight };
}

function GoldfishGameArea({ deck }: { deck: DeckDataForGoldfish }) {
  const { isLoupeVisible } = useCardPreview();

  const [viewport, setViewport] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const loupeWidth = isLoupeVisible ? LOUPE_PANEL_WIDTH : LOUPE_COLLAPSED_WIDTH;

  const dimensions = useMemo(
    () => getEffectiveDimensions(viewport.width, viewport.height, loupeWidth),
    [viewport.width, viewport.height, loupeWidth]
  );

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

      {/* Game area container */}
      <div
        style={{
          position: 'relative',
          flex: 1,
          height: '100%',
        }}
      >
        {/* Game area — capped width, centered. Acts as positioning context for all overlays. */}
        <div
          style={{
            position: 'relative',
            width: dimensions.width,
            height: '100%',
            margin: '0 auto',
          }}
        >
          <GoldfishCanvas width={dimensions.width} height={dimensions.height} />
        </div>
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
