'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

export interface CardChoiceButton {
  label: string;
  color: 'good' | 'evil';
  onClick: () => void;
}

interface PromptItem {
  id: number;
  key: string;
  message: string;
  choices: CardChoiceButton[];
}

let promptId = 0;
const showListeners: ((p: PromptItem) => void)[] = [];
const dismissListeners: ((key: string) => void)[] = [];
const clearListeners: (() => void)[] = [];

export function showCardChoicePrompt(opts: { key: string; message: string; choices: CardChoiceButton[] }): void {
  const item: PromptItem = { id: ++promptId, ...opts };
  showListeners.forEach(fn => fn(item));
}

export function dismissCardChoicePrompt(key: string): void {
  dismissListeners.forEach(fn => fn(key));
}

export function clearCardChoicePrompts(): void {
  clearListeners.forEach(fn => fn());
}

const COLOR_HEX: Record<'good' | 'evil', { stroke: string; glow: string }> = {
  good: { stroke: '#22c55e', glow: 'rgba(34, 197, 94, 0.18)' },
  evil: { stroke: '#dc2626', glow: 'rgba(220, 38, 38, 0.18)' },
};

// Strip a trailing set / variant suffix from a card name for display.
// Matches " (...)" or " [...]" only at the very end. Doesn't touch verse
// references mid-name (e.g. "Lost Soul \"Harvest\" [John 4:35]" — the
// bracket suffix is the verse, but for prompt display the simpler form
// is preferred since the prompt already implies "the card you just played").
function cleanCardName(name: string): string {
  return name.replace(/\s*[(\[][^)\]]+[)\]]\s*$/, '').trim() || name;
}

export function CardChoicePromptContainer() {
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const promptElsRef = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const onShow = (p: PromptItem) => {
      setPrompts(prev => [...prev.filter(q => q.key !== p.key), p]);
    };
    const onDismiss = (key: string) => {
      setPrompts(prev => prev.filter(q => q.key !== key));
    };
    const onClear = () => setPrompts([]);
    showListeners.push(onShow);
    dismissListeners.push(onDismiss);
    clearListeners.push(onClear);
    return () => {
      const i = showListeners.indexOf(onShow);
      if (i >= 0) showListeners.splice(i, 1);
      const j = dismissListeners.indexOf(onDismiss);
      if (j >= 0) dismissListeners.splice(j, 1);
      const k = clearListeners.indexOf(onClear);
      if (k >= 0) clearListeners.splice(k, 1);
    };
  }, []);

  // Escape closes the most recent prompt without applying an effect.
  useEffect(() => {
    if (prompts.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setPrompts(prev => prev.slice(0, -1));
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [prompts.length]);

  // Mousedown outside the prompt closes the most recent prompt without effect.
  useEffect(() => {
    if (prompts.length === 0) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      for (const el of promptElsRef.current.values()) {
        if (el.contains(target)) return;
      }
      setPrompts(prev => prev.slice(0, -1));
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [prompts.length]);

  return (
    <div
      style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 950,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {prompts.map(prompt => (
          <motion.div
            key={prompt.id}
            ref={(el: HTMLDivElement | null) => {
              if (el) promptElsRef.current.set(prompt.id, el);
              else promptElsRef.current.delete(prompt.id);
            }}
            drag
            dragMomentum={false}
            dragElastic={0}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            whileDrag={{ cursor: 'grabbing' }}
            style={{
              position: 'relative',
              background: 'rgba(20, 20, 20, 0.92)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 10,
              padding: '18px 22px 20px',
              color: 'var(--gf-text-bright)',
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              boxShadow: '0 12px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.4)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 14,
              minWidth: 320,
              maxWidth: 420,
              pointerEvents: 'auto',
              cursor: 'grab',
              userSelect: 'none',
            }}
          >
            {/* Dismiss — top-right corner, generous hit target */}
            <button
              aria-label="Dismiss"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => dismissCardChoicePrompt(prompt.key)}
              style={{
                position: 'absolute',
                top: 6,
                right: 6,
                width: 32,
                height: 32,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: 'rgba(255, 255, 255, 0.7)',
                cursor: 'pointer',
                padding: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 6,
                transition: 'color 0.12s, background 0.12s, border-color 0.12s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 1)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.14)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)';
                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)';
              }}
            >
              <X size={16} strokeWidth={2.25} />
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.16em',
                  textTransform: 'uppercase',
                  color: 'rgba(255, 255, 255, 0.5)',
                  fontFamily: 'var(--font-geist-sans), system-ui, sans-serif',
                }}
              >
                Resolve
              </div>
              <div
                style={{
                  fontSize: 18,
                  textAlign: 'center',
                  letterSpacing: '0.02em',
                  lineHeight: 1.2,
                }}
              >
                {cleanCardName(prompt.message)}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${prompt.choices.length}, 1fr)`, gap: 10 }}>
              {prompt.choices.map((choice, idx) => {
                const { stroke, glow } = COLOR_HEX[choice.color];
                return (
                  <button
                    key={idx}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={choice.onClick}
                    style={{
                      background: glow,
                      border: `1.5px solid ${stroke}`,
                      borderRadius: 8,
                      padding: '10px 16px',
                      color: stroke,
                      fontFamily: 'var(--font-cinzel), Georgia, serif',
                      fontSize: 14,
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                      transition: 'background 0.14s, transform 0.08s, box-shadow 0.14s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `${stroke}33`;
                      e.currentTarget.style.boxShadow = `0 0 16px ${glow}`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = glow;
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    onMouseDown={(e) => { e.currentTarget.style.transform = 'scale(0.97)'; }}
                    onMouseUp={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                  >
                    {choice.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
