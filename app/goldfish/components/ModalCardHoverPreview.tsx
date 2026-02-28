'use client';

import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

interface HoverState {
  imageUrl: string;
  cardName: string;
  x: number;
  y: number;
}

export function useModalCardHover(delay = 400) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCardMouseEnter = useCallback((imgFile: string, cardName: string, e: React.MouseEvent) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const x = e.clientX;
    const y = e.clientY;
    timerRef.current = setTimeout(() => {
      const imageUrl = getCardImageUrl(imgFile);
      if (imageUrl) {
        setHover({ imageUrl, cardName, x, y });
      }
    }, delay);
  }, [delay]);

  const onCardMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHover(null);
  }, []);

  return { hover, onCardMouseEnter, onCardMouseLeave };
}

export function ModalCardHoverPreview({ hover }: { hover: HoverState | null }) {
  if (!hover) return null;

  const previewWidth = 280;
  const previewHeight = previewWidth * 1.4;

  let left = hover.x + 16;
  let top = hover.y - previewHeight / 2;

  if (left + previewWidth > window.innerWidth - 8) {
    left = hover.x - previewWidth - 16;
  }
  if (top < 8) {
    top = 8;
  }
  if (top + previewHeight > window.innerHeight - 8) {
    top = window.innerHeight - previewHeight - 8;
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
        <img
          src={hover.imageUrl}
          alt={hover.cardName}
          width={previewWidth}
          style={{
            display: 'block',
            borderRadius: 6,
          }}
        />
      </motion.div>
    </AnimatePresence>
  );
}
