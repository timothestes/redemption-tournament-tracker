'use client';

import Image from 'next/image';
import type { GameCard } from '@/app/goldfish/types';

interface CardPreviewPanelProps {
  card: GameCard | null;
}

export default function CardPreviewPanel({ card }: CardPreviewPanelProps) {
  if (!card) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'rgba(232, 213, 163, 0.3)',
        fontSize: 12, fontStyle: 'italic', padding: 16,
        fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
      }}>
        Hover a card to preview
      </div>
    );
  }

  const showBack = card.isFlipped;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8,
      padding: 8, overflow: 'hidden',
      fontFamily: 'var(--font-geist-sans, system-ui, sans-serif)',
    }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1.4' }}>
        {showBack ? (
          <div style={{
            width: '100%', height: '100%',
            background: 'linear-gradient(135deg, #2a1f14, #1a150e)',
            border: '1px solid rgba(107, 78, 39, 0.4)',
            borderRadius: 4,
          }} />
        ) : card.cardImgFile ? (
          <Image
            src={card.cardImgFile}
            alt={card.cardName}
            fill
            style={{ objectFit: 'contain', borderRadius: 4 }}
            sizes="220px"
            unoptimized
          />
        ) : null}
      </div>
      <div style={{ fontSize: 12, color: '#e8d5a3', lineHeight: 1.4 }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>{card.cardName}</div>
        {card.type && (
          <div style={{ color: 'rgba(232, 213, 163, 0.6)', fontSize: 11 }}>
            {card.type}{card.brigade ? ` \u00b7 ${card.brigade}` : ''}
          </div>
        )}
        {(card.strength || card.toughness) && (
          <div style={{ fontSize: 11, color: 'rgba(232, 213, 163, 0.5)' }}>
            {card.strength}/{card.toughness}
          </div>
        )}
        {card.specialAbility && (
          <div style={{
            marginTop: 4, fontSize: 11, color: 'rgba(232, 213, 163, 0.7)',
            maxHeight: 120, overflowY: 'auto', lineHeight: 1.45,
          }}>
            {card.specialAbility}
          </div>
        )}
      </div>
    </div>
  );
}
