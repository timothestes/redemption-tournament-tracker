'use client';

import { useEffect } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence } from 'framer-motion';
import { GameCard } from '../types';
import { X } from 'lucide-react';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

interface CardZoomModalProps {
  card: GameCard;
  onClose: () => void;
}

export function CardZoomModal({ card, onClose }: CardZoomModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const imageUrl = getCardImageUrl(card.cardImgFile);

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 600,
          cursor: 'pointer',
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col sm:flex-row gap-3 sm:gap-5"
          style={{
            maxWidth: '90vw',
            maxHeight: '90vh',
            cursor: 'default',
            overflowY: 'auto',
          }}
        >
          {/* Card image */}
          {imageUrl && (
            <Image
              src={imageUrl}
              alt={card.cardName}
              width={400}
              height={560}
              style={{
                maxHeight: '80vh',
                maxWidth: 'min(400px, 85vw)',
                width: 'auto',
                height: 'auto',
                borderRadius: 8,
                boxShadow: '0 12px 40px rgba(0,0,0,0.8), 0 0 20px rgba(212,168,103,0.2)',
              }}
            />
          )}

          {/* Card details */}
          <div
            style={{
              background: 'var(--gf-bg)',
              border: '1px solid var(--gf-border)',
              borderRadius: 8,
              padding: 20,
              minWidth: 0,
              maxWidth: 300,
              width: '100%',
              color: 'var(--gf-text)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              position: 'relative',
            }}
          >
            <button
              onClick={onClose}
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--gf-text-dim)',
              }}
            >
              <X size={16} />
            </button>

            <h3 style={{ fontSize: 16, color: 'var(--gf-text-bright)', marginBottom: 12 }}>
              {card.cardName}
            </h3>

            <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div>
                <span style={{ color: 'var(--gf-text-dim)' }}>Type: </span>
                {card.type}
              </div>
              {card.brigade && (
                <div>
                  <span style={{ color: 'var(--gf-text-dim)' }}>Brigade: </span>
                  {card.brigade}
                </div>
              )}
              {(card.strength || card.toughness) && (
                <div>
                  <span style={{ color: 'var(--gf-text-dim)' }}>Str/Tough: </span>
                  {card.strength || '–'}/{card.toughness || '–'}
                </div>
              )}
              {card.specialAbility && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: 'var(--gf-text-dim)' }}>Ability: </span>
                  <p style={{ marginTop: 4, lineHeight: 1.5, fontSize: 10 }}>
                    {card.specialAbility}
                  </p>
                </div>
              )}
              {card.cardSet && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: 'var(--gf-text-dim)' }}>Set: </span>
                  {card.cardSet}
                </div>
              )}
              {card.notes && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ color: 'var(--gf-text-dim)' }}>Notes: </span>
                  <p style={{ marginTop: 2, fontStyle: 'italic' }}>{card.notes}</p>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
