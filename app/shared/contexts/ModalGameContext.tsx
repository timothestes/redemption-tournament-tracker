'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { GameCard, ZoneId } from '@/app/shared/types/gameCard';

export interface ModalGameActions {
  moveCard(instanceId: string, toZone: ZoneId, toIndex?: number, posX?: number, posY?: number): void;
  moveCardsBatch(instanceIds: string[], toZone: ZoneId): void;
  moveCardToTopOfDeck(instanceId: string): void;
  moveCardToBottomOfDeck(instanceId: string): void;
  shuffleDeck(): void;
  shuffleCardIntoDeck(instanceId: string): void;
}

export interface ModalGameContextValue {
  zones: Record<string, GameCard[]>;
  actions: ModalGameActions;
}

const ModalGameContext = createContext<ModalGameContextValue | null>(null);

export function ModalGameProvider({ children, value }: { children: ReactNode; value: ModalGameContextValue }) {
  return <ModalGameContext.Provider value={value}>{children}</ModalGameContext.Provider>;
}

export function useModalGame(): ModalGameContextValue {
  const ctx = useContext(ModalGameContext);
  if (!ctx) throw new Error('useModalGame must be used within a ModalGameProvider');
  return ctx;
}
