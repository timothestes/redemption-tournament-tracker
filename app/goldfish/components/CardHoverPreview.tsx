'use client';

import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { GameCard } from '../types';
import { getCardImageUrl } from '../../shared/utils/cardImageUrl';

interface CardHoverPreviewProps {
  card: GameCard;
  anchorX: number;
  anchorY: number;
}

export function CardHoverPreview({ card, anchorX, anchorY }: CardHoverPreviewProps) {
  const previewWidth = 280;
  const previewHeight = previewWidth * 1.4;
  const imageUrl = getCardImageUrl(card.cardImgFile);

  if (!imageUrl) return null;

  // Position: above-right by default, flip if needed
  let left = anchorX + 12;
  let top = anchorY - previewHeight - 12;

  if (left + previewWidth > window.innerWidth - 8) {
    left = anchorX - previewWidth - 12;
  }
  if (top < 8) {
    top = anchorY + 12;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        style={{
          position: 'fixed',
          left,
          top,
          width: previewWidth,
          zIndex: 1000,
          pointerEvents: 'none',
          borderRadius: 6,
          boxShadow: '0 8px 32px rgba(0,0,0,0.8), 0 0 12px rgba(212,168,103,0.3)',
        }}
      >
        <Image
          src={imageUrl}
          alt={card.cardName}
          width={previewWidth}
          height={previewHeight}
          style={{
            display: 'block',
            borderRadius: 6,
            transform: card.isMeek ? 'rotate(180deg)' : undefined,
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
