'use client';

import { useMemo } from 'react';

const LOADING_MESSAGES = [
  'Unfurling Scrolls...',
  'Dusting off Scrolls...',
  'Consulting the Divine Council...',
  'Gathering Lost Souls...',
  'Sanhedrin voting...',
  'Council of Jerusalem debating...',
  'Parting the Red Sea...',
  'Waiting on Balaam\'s donkey to move...',
  'Rebuilding the Temple...',
  'Counting the tribes...',
  'Rolling away the stone...',
  'Loading the Ark...',
  'Wandering in the wilderness...',
  'Casting lots...',
  'Feeding the five thousand...',
  'Preparing a scarlet line...',
  'Wrestling an angel...',
  'Escaping from a big fish...',
  'Cleaning out the Lion\s den...',
  'Interpreting Pharaoh\'s dream...',
  'Plotting against Fortress Alstad...',
  'Stoking a really big fire...',
  'Gathering manna...',
  'Taking a dip in the pool of Bethesda...',
  'Fleeing from Potiphar\'s Wife...',
  'Walking on water...',
  'Sailing to Rome...',
  'Preparing the last supper...',
  'Downloading some heavy revies at Patmos...',
  'Drafting up Darius\'s Decree...',
  'Studying ancient Ugarit...',
];

export function LoadingScreen({ progress }: { progress: number }) {
  const message = useMemo(
    () => LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)],
    []
  );
  const percent = Math.round(progress * 100);

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: '#0d0905',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
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
          opacity: 0.4,
        }}
      />

      {/* Vignette */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background:
            'radial-gradient(ellipse 90% 85% at 50% 50%, transparent 60%, rgba(0,0,0,0.85) 100%)',
        }}
      />

      {/* Content */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <p
          className="font-cinzel"
          style={{
            color: '#c9b99a',
            fontSize: 20,
            letterSpacing: '0.05em',
            marginBottom: 24,
          }}
        >
          {message}
        </p>

        {/* Progress bar */}
        <div
          style={{
            width: 320,
            height: 8,
            background: '#2a1f12',
            borderRadius: 2,
            overflow: 'hidden',
            margin: '0 auto',
          }}
        >
          <div
            style={{
              width: `${percent}%`,
              height: '100%',
              background: '#8b6532',
              transition: 'width 0.2s ease',
            }}
          />
        </div>

        <p
          style={{
            color: '#8b6532',
            fontSize: 14,
            marginTop: 12,
            fontFamily: 'monospace',
          }}
        >
          {percent}%
        </p>
      </div>
    </div>
  );
}
