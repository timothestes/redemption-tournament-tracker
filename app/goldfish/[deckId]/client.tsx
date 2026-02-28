'use client';

import { useState, useEffect, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { GameProvider } from '../state/GameContext';
import { LoadingScreen } from '../components/LoadingScreen';
import { useImagePreloader } from '../hooks/useImagePreloader';
import type { DeckDataForGoldfish } from '../types';

const GoldfishCanvas = dynamic(() => import('../components/GoldfishCanvas'), { ssr: false });

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

interface GoldfishClientProps {
  deck: DeckDataForGoldfish;
}

export default function GoldfishClient({ deck }: GoldfishClientProps) {
  const [dimensions, setDimensions] = useState({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  useEffect(() => {
    const onResize = () =>
      setDimensions({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
    <GameProvider deck={deck}>
      <div
        style={{
          position: 'relative',
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          background: '#0d0905',
        }}
      >
        {/* Cave background image */}
        <div
          className="cave-bg"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage: 'url(/gameplay/cave_background.png)',
            backgroundSize: 'cover',
            backgroundPosition: 'center 70%',
            backgroundRepeat: 'no-repeat',
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

        {/* Konva canvas */}
        <GoldfishCanvas width={dimensions.width} height={dimensions.height} />
      </div>
    </GameProvider>
  );
}
