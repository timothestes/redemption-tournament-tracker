'use client';

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface Toast {
  id: number;
  message: string;
}

let toastId = 0;
const listeners: ((toast: Toast) => void)[] = [];
const clearListeners: (() => void)[] = [];

export function showGameToast(message: string) {
  const toast: Toast = { id: ++toastId, message };
  listeners.forEach(fn => fn(toast));
}

export function clearGameToasts() {
  clearListeners.forEach(fn => fn());
}

export function GameToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handler = (toast: Toast) => {
      setToasts(prev => [...prev, toast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 2500);
    };
    const clearHandler = () => setToasts([]);
    listeners.push(handler);
    clearListeners.push(clearHandler);
    return () => {
      const idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
      const cidx = clearListeners.indexOf(clearHandler);
      if (cidx >= 0) clearListeners.splice(cidx, 1);
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 70,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        display: 'flex',
        flexDirection: 'column-reverse',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'none',
      }}
    >
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            style={{
              background: 'var(--gf-bg)',
              border: '1px solid var(--gf-border)',
              borderRadius: 6,
              padding: '8px 16px',
              color: 'var(--gf-text-bright)',
              fontSize: 13,
              fontFamily: 'var(--font-cinzel), Georgia, serif',
              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            {toast.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
