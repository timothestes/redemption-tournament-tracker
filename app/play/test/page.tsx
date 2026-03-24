'use client';

import { useRef, useState, useEffect } from 'react';
import { Stage, Layer, Rect, Text, Group } from 'react-konva';
import { calculateMirrorLayout, getCardDimensions } from '../layout/mirrorLayout';
import CardPreviewPanel from '../components/CardPreviewPanel';
import ChatPanel from '../components/ChatPanel';
import type { GameCard } from '@/app/goldfish/types';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockChatMessages = [
  {
    id: BigInt(1),
    gameId: BigInt(1),
    senderId: BigInt(1),
    text: 'Good game!',
    sentAt: { microsSinceUnixEpoch: BigInt(Date.now() * 1000) },
  },
  {
    id: BigInt(2),
    gameId: BigInt(1),
    senderId: BigInt(2),
    text: 'Thanks, you too!',
    sentAt: { microsSinceUnixEpoch: BigInt(Date.now() * 1000 + 1000000) },
  },
];

const mockGameActions = [
  {
    id: BigInt(1),
    gameId: BigInt(1),
    playerId: BigInt(1),
    actionType: 'DRAW',
    payload: '{}',
    turnNumber: BigInt(1),
    phase: 'draw',
    timestamp: { microsSinceUnixEpoch: BigInt(Date.now() * 1000) },
  },
];

const mockPlayerNames: Record<string, string> = { '1': 'Player A', '2': 'Player B' };

// Mock zone card counts for display
const ZONE_COUNTS: Record<string, number> = {
  territory: 4,
  'land-of-bondage': 2,
  deck: 50,
  discard: 3,
  reserve: 7,
  banish: 0,
  'land-of-redemption': 1,
};

// Accent colors for zone backgrounds
const ZONE_FILL = 'rgba(20, 14, 8, 0.85)';
const ZONE_STROKE = 'rgba(107, 78, 39, 0.4)';
const ZONE_LABEL_COLOR = 'rgba(232, 213, 163, 0.45)';
const ZONE_COUNT_COLOR = 'rgba(232, 213, 163, 0.75)';

// ---------------------------------------------------------------------------
// TestBoardCanvas — self-contained Konva board using static mock data
// ---------------------------------------------------------------------------

function TestBoardCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width: Math.max(width, 1), height: Math.max(height, 1) });
    });

    observer.observe(el);
    // Seed initial size
    setSize({ width: el.clientWidth || 800, height: el.clientHeight || 600 });
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const layout = calculateMirrorLayout(width, height);
  const { cardWidth, cardHeight } = getCardDimensions(width);

  // Pile zone thumbnails at 60% of main card size to fit within sidebar slots
  const pileCardScale = 0.6;
  const pileCardWidth = Math.round(cardWidth * pileCardScale);
  const pileCardHeight = Math.round(cardHeight * pileCardScale);

  // Render a single zone rectangle with label and count badge
  function renderZone(zone: { x: number; y: number; width: number; height: number; label: string }, key: string, isOpponent: boolean) {
    const count = ZONE_COUNTS[key] ?? 0;
    const isTerritory = key === 'territory';
    const isLob = key === 'land-of-bondage';
    const isSidebar = !isTerritory && !isLob;
    const labelFontSize = isSidebar ? 9 : 11;

    return (
      <Group key={`${isOpponent ? 'opp' : 'my'}-${key}`}>
        {/* Zone background */}
        <Rect
          x={zone.x}
          y={zone.y}
          width={zone.width}
          height={zone.height}
          fill={ZONE_FILL}
          stroke={ZONE_STROKE}
          strokeWidth={1}
          cornerRadius={3}
        />
        {/* Zone label */}
        <Text
          x={zone.x + 6}
          y={zone.y + 6}
          text={zone.label}
          fontSize={labelFontSize}
          fill={ZONE_LABEL_COLOR}
          fontFamily="var(--font-geist-sans, system-ui, sans-serif)"
          listening={false}
        />
        {/* Card count badge */}
        {(isTerritory || isLob) && count > 0 && (
          <Group>
            <Rect
              x={zone.x + zone.width - 28}
              y={zone.y + 4}
              width={24}
              height={16}
              fill="rgba(107, 78, 39, 0.35)"
              cornerRadius={8}
            />
            <Text
              x={zone.x + zone.width - 28}
              y={zone.y + 6}
              width={24}
              text={String(count)}
              fontSize={10}
              fill={ZONE_COUNT_COLOR}
              align="center"
              fontFamily="var(--font-geist-sans, system-ui, sans-serif)"
              listening={false}
            />
          </Group>
        )}
        {/* Mock card rectangles in territory zone (free-form) */}
        {isTerritory && count > 0 && Array.from({ length: Math.min(count, 5) }).map((_, i) => (
          <Rect
            key={i}
            x={zone.x + 12 + i * (cardWidth + 6)}
            y={zone.y + zone.height / 2 - cardHeight / 2}
            width={cardWidth}
            height={cardHeight}
            fill="rgba(40, 28, 16, 0.9)"
            stroke="rgba(196, 149, 90, 0.5)"
            strokeWidth={1}
            cornerRadius={2}
          />
        ))}
        {/* Mock card rectangles in LOB zone (auto-arranged horizontal strip) */}
        {isLob && count > 0 && (() => {
          const padding = 8;
          const maxSpacing = cardWidth + 6;
          const minSpacing = cardWidth * 0.4;
          const availWidth = zone.width - padding * 2;
          const idealSpacing = Math.min(maxSpacing, availWidth / Math.max(count, 1));
          const spacing = Math.max(minSpacing, idealSpacing);
          const cy = zone.y + zone.height / 2 - cardHeight / 2;
          return Array.from({ length: Math.min(count, 5) }).map((_, i) => (
            <Rect
              key={i}
              x={zone.x + padding + i * spacing}
              y={cy}
              width={cardWidth}
              height={cardHeight}
              fill="rgba(40, 28, 16, 0.9)"
              stroke="rgba(196, 149, 90, 0.5)"
              strokeWidth={1}
              cornerRadius={2}
            />
          ));
        })()}
        {/* Ghost text for empty territory */}
        {isTerritory && count === 0 && (
          <Text
            x={zone.x}
            y={zone.y + zone.height / 2 - 10}
            width={zone.width}
            text="Drop characters and enhancements here"
            fontSize={13}
            fill="rgba(232, 213, 163, 0.15)"
            align="center"
          />
        )}
        {/* Sidebar pile — show a small card-back stack */}
        {isSidebar && count > 0 && (
          <Rect
            x={zone.x + zone.width / 2 - pileCardWidth / 2}
            y={zone.y + zone.height / 2 - pileCardHeight / 2}
            width={pileCardWidth}
            height={pileCardHeight}
            fill="rgba(42, 31, 20, 0.9)"
            stroke="rgba(196, 149, 90, 0.4)"
            strokeWidth={1}
            cornerRadius={2}
          />
        )}
      </Group>
    );
  }

  // Center divider line
  const dividerY = layout.myHandRect.y - (layout.myHandRect.y - (layout.opponentHandRect.y + layout.opponentHandRect.height)) / 2;

  return (
    <div
      ref={containerRef}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#0a0805' }}
    >
      <Stage width={width} height={height}>
        <Layer>
          {/* Board background */}
          <Rect x={0} y={0} width={width} height={height} fill="#0a0805" />

          {/* Opponent hand area */}
          <Rect
            x={layout.opponentHandRect.x}
            y={layout.opponentHandRect.y}
            width={layout.opponentHandRect.width}
            height={layout.opponentHandRect.height}
            fill="rgba(15, 10, 5, 0.7)"
            stroke="rgba(107, 78, 39, 0.25)"
            strokeWidth={1}
          />
          <Text
            x={12}
            y={layout.opponentHandRect.y + layout.opponentHandRect.height / 2 - 6}
            text="Opponent Hand  ·  7 cards"
            fontSize={10}
            fill="rgba(232, 213, 163, 0.35)"
            fontFamily="var(--font-geist-sans, system-ui, sans-serif)"
          />

          {/* Opponent zones */}
          {Object.entries(layout.opponentZones).map(([key, zone]) =>
            renderZone(zone, key, true)
          )}

          {/* Center divider */}
          <Rect
            x={0}
            y={dividerY}
            width={width}
            height={1}
            fill="rgba(107, 78, 39, 0.3)"
          />

          {/* My zones */}
          {Object.entries(layout.myZones).map(([key, zone]) =>
            renderZone(zone, key, false)
          )}

          {/* My hand area */}
          <Rect
            x={layout.myHandRect.x}
            y={layout.myHandRect.y}
            width={layout.myHandRect.width}
            height={layout.myHandRect.height}
            fill="rgba(15, 10, 5, 0.7)"
            stroke="rgba(107, 78, 39, 0.25)"
            strokeWidth={1}
          />
          <Text
            x={12}
            y={layout.myHandRect.y + layout.myHandRect.height / 2 - 6}
            text="My Hand  ·  7 cards"
            fontSize={10}
            fill="rgba(232, 213, 163, 0.35)"
            fontFamily="var(--font-geist-sans, system-ui, sans-serif)"
          />

          {/* Test mode label — centered at bottom */}
          <Text
            x={width / 2 - 80}
            y={height - 30}
            text="TEST MODE — Static Mock Data"
            fontSize={11}
            fill="rgba(196, 149, 90, 0.4)"
            fontFamily="var(--font-geist-sans, system-ui, sans-serif)"
            align="center"
            width={160}
          />
        </Layer>
      </Stage>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PlayTestPage() {
  const [hoveredCard] = useState<GameCard | null>(null);

  return (
    <div
      style={{
        display: 'flex',
        width: '100vw',
        height: '100dvh',
        background: '#0a0805',
        overflow: 'hidden',
      }}
    >
      {/* Left sidebar */}
      <div
        style={{
          width: 'clamp(200px, 14vw, 280px)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(10, 8, 5, 0.97)',
          borderRight: '1px solid rgba(107, 78, 39, 0.3)',
        }}
      >
        {/* Card Preview — top */}
        <div
          style={{
            flexShrink: 0,
            borderBottom: '1px solid rgba(107, 78, 39, 0.2)',
          }}
        >
          <CardPreviewPanel card={hoveredCard} />
        </div>

        {/* Chat — bottom, takes remaining space */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <ChatPanel
            chatMessages={mockChatMessages}
            gameActions={mockGameActions}
            myPlayerId={BigInt(1)}
            onSendChat={() => {}}
            playerNames={mockPlayerNames}
          />
        </div>
      </div>

      {/* Game canvas — takes remaining width */}
      <TestBoardCanvas />
    </div>
  );
}
