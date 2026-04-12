'use client';

import { useCardPreview } from '../state/CardPreviewContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const BLOB_BASE_URL = process.env.NEXT_PUBLIC_BLOB_BASE_URL || '';

function sanitizeImgFile(f: string): string {
  return f.replace(/\.jpe?g$/i, '');
}

function getCardImageUrl(imgFile: string): string {
  if (!imgFile) return '';
  if (imgFile.startsWith('/')) return imgFile;
  return `${BLOB_BASE_URL}/card-images/${sanitizeImgFile(imgFile)}.jpg`;
}

const PANEL_WIDTH = 260;
const COLLAPSED_WIDTH = 36;
const HEADER_HEIGHT = 40;

export { PANEL_WIDTH as LOUPE_PANEL_WIDTH, COLLAPSED_WIDTH as LOUPE_COLLAPSED_WIDTH };

export function CardLoupePanel() {
  const { previewCard, isLoupeVisible, toggleLoupe } = useCardPreview();

  const imageUrl = previewCard ? getCardImageUrl(previewCard.cardImgFile) : '';
  const totalWidth = isLoupeVisible ? PANEL_WIDTH : COLLAPSED_WIDTH;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: totalWidth,
        minWidth: totalWidth,
        height: isLoupeVisible ? '100%' : 'auto',
        background: isLoupeVisible ? 'rgba(13, 9, 5, 0.6)' : 'transparent',
        borderLeft: isLoupeVisible ? '1px solid rgba(107, 78, 39, 0.35)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 550,
        overflow: 'hidden',
        transition: 'width 0.2s ease, min-width 0.2s ease',
      }}
    >
      {/* Header bar — always visible, matches PhaseBar style */}
      <button
        onClick={toggleLoupe}
        title={isLoupeVisible ? 'Hide preview (Tab)' : 'Show preview (Tab)'}
        style={{
          width: '100%',
          height: HEADER_HEIGHT,
          minHeight: HEADER_HEIGHT,
          background: 'var(--gf-bg, rgba(30,22,16,0.92))',
          borderBottom: '1px solid var(--gf-border, rgba(107,78,39,0.4))',
          border: 'none',
          borderBlockEnd: '1px solid var(--gf-border, rgba(107,78,39,0.4))',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: isLoupeVisible ? 'flex-start' : 'center',
          gap: 6,
          padding: isLoupeVisible ? '0 12px' : '0',
          color: 'var(--gf-text-dim, rgba(232,213,163,0.5))',
          transition: 'color 0.15s, background 0.15s',
          flexShrink: 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--gf-text-bright, #e8d5a3)';
          e.currentTarget.style.background = 'var(--gf-hover, rgba(42,31,18,0.95))';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--gf-text-dim, rgba(232,213,163,0.5))';
          e.currentTarget.style.background = 'var(--gf-bg, rgba(30,22,16,0.92))';
        }}
      >
        {isLoupeVisible ? (
          <>
            <ChevronRight size={14} />
            <span
              style={{
                fontFamily: 'var(--font-cinzel), Georgia, serif',
                fontSize: 11,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              Preview
            </span>
          </>
        ) : (
          <ChevronLeft size={14} />
        )}
      </button>

      {/* Panel content — only when visible */}
      {isLoupeVisible && (
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 12px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {previewCard && imageUrl ? (
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                width: '100%',
              }}
            >
              <div
                style={{
                  borderRadius: 6,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.7), 0 0 8px rgba(212,168,103,0.2)',
                  overflow: 'hidden',
                  width: PANEL_WIDTH - 24,
                  background: '#000',
                }}
              >
                <img
                  src={imageUrl}
                  alt={previewCard.cardName}
                  width={PANEL_WIDTH - 24}
                  height={(PANEL_WIDTH - 24) * 1.4}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    transform: previewCard.isMeek ? 'rotate(180deg)' : undefined,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 12,
                  color: '#e8d5a3',
                  textAlign: 'center',
                  letterSpacing: '0.05em',
                  lineHeight: 1.3,
                  maxWidth: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {previewCard.cardName}
              </span>
            </div>
          ) : (
            <div
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                opacity: 0.55,
              }}
            >
              <div
                style={{
                  width: PANEL_WIDTH - 24,
                  height: (PANEL_WIDTH - 24) * 1.4,
                  borderRadius: 6,
                  border: '1px dashed rgba(107, 78, 39, 0.5)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <img
                  src="/gameplay/cardback.webp"
                  alt="Card preview"
                  width={PANEL_WIDTH - 24}
                  height={(PANEL_WIDTH - 24) * 1.4}
                  style={{
                    display: 'block',
                    width: '100%',
                    height: 'auto',
                    borderRadius: 6,
                    opacity: 0.7,
                  }}
                />
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-cinzel), Georgia, serif',
                  fontSize: 11,
                  color: '#e8d5a3',
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                }}
              >
                Hover a card
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
