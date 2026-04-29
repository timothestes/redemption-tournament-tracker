'use client';

import { useMemo, useRef } from 'react';
import type { GameCard, Counter } from '@/app/goldfish/types';
import type { CardInstance, CardCounter } from '@/lib/spacetimedb/module_bindings/types';

const EMPTY_COUNTERS: readonly CardCounter[] = [];
const EMPTY_GAME_COUNTERS: readonly Counter[] = [];

/**
 * Adapt a SpacetimeDB CardInstance row + counters into the GameCard shape
 * expected by GameCardNode. Pure — does no caching by itself; `useStableAdaptedCards`
 * wraps this with per-card reference stability.
 */
export function cardInstanceToGameCard(
  card: CardInstance,
  counters: readonly CardCounter[],
  owner: 'player1' | 'player2',
): GameCard {
  return {
    instanceId: String(card.id),
    cardName: card.cardName,
    cardSet: card.cardSet,
    cardImgFile: card.cardImgFile,
    type: card.cardType,
    brigade: card.brigade,
    strength: card.strength,
    toughness: card.toughness,
    specialAbility: card.specialAbility,
    identifier: card.identifier,
    reference: card.reference,
    alignment: card.alignment,
    isMeek: card.isMeek,
    isFlipped: card.isFlipped,
    isToken: card.isToken,
    zone: card.zone as GameCard['zone'],
    ownerId: owner,
    notes: card.notes,
    posX: card.posX ? parseFloat(card.posX) : undefined,
    posY: card.posY ? parseFloat(card.posY) : undefined,
    equippedTo:
      card.equippedToInstanceId !== 0n
        ? String(card.equippedToInstanceId)
        : undefined,
    counters:
      counters.length === 0
        ? (EMPTY_GAME_COUNTERS as Counter[])
        : counters.map((c) => ({
            color: c.color as Counter['color'],
            count: Number(c.count),
          })),
    revealUntil:
      card.revealExpiresAt === undefined
        ? undefined
        : Number(card.revealExpiresAt.microsSinceUnixEpoch / 1000n),
    revealDurationMs:
      card.revealExpiresAt === undefined || card.revealStartedAt === undefined
        ? undefined
        : Number(
            (card.revealExpiresAt.microsSinceUnixEpoch -
              card.revealStartedAt.microsSinceUnixEpoch) /
              1000n,
          ),
    outlineColor:
      card.outlineColor === 'good' || card.outlineColor === 'evil'
        ? card.outlineColor
        : undefined,
  };
}

function countersEqual(a: readonly Counter[], b: readonly Counter[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].color !== b[i].color || a[i].count !== b[i].count) return false;
  }
  return true;
}

function gameCardEquals(a: GameCard, b: GameCard): boolean {
  return (
    a.instanceId === b.instanceId &&
    a.cardName === b.cardName &&
    a.cardSet === b.cardSet &&
    a.cardImgFile === b.cardImgFile &&
    a.type === b.type &&
    a.brigade === b.brigade &&
    a.strength === b.strength &&
    a.toughness === b.toughness &&
    a.specialAbility === b.specialAbility &&
    a.identifier === b.identifier &&
    a.reference === b.reference &&
    a.alignment === b.alignment &&
    a.isMeek === b.isMeek &&
    a.isFlipped === b.isFlipped &&
    a.isToken === b.isToken &&
    a.zone === b.zone &&
    a.ownerId === b.ownerId &&
    a.notes === b.notes &&
    a.posX === b.posX &&
    a.posY === b.posY &&
    a.equippedTo === b.equippedTo &&
    a.revealUntil === b.revealUntil &&
    a.revealDurationMs === b.revealDurationMs &&
    a.outlineColor === b.outlineColor &&
    countersEqual(a.counters, b.counters)
  );
}

/**
 * Build a Map<id, GameCard> for the given cards, preserving GameCard
 * object references across renders when the underlying content is unchanged.
 * This is the key piece that makes `memo(GameCardNode)` actually effective:
 * unchanged cards return the same reference, so the shallow prop compare
 * short-circuits and React skips reconciling them.
 *
 * Owner is derived from `ownerId`: cards owned by the opponent are 'player2',
 * everything else (own cards + shared `ownerId === 0n` cards) is 'player1'.
 */
export function useStableAdaptedCards(
  cards: readonly CardInstance[],
  counters: Map<bigint, CardCounter[]>,
  opponentPlayerId: bigint | undefined,
): Map<bigint, GameCard> {
  const cacheRef = useRef<Map<bigint, GameCard>>(new Map());

  return useMemo(() => {
    const prev = cacheRef.current;
    const next = new Map<bigint, GameCard>();

    for (const card of cards) {
      const cardCounters = counters.get(card.id) ?? EMPTY_COUNTERS;
      const owner: 'player1' | 'player2' =
        opponentPlayerId !== undefined && card.ownerId === opponentPlayerId
          ? 'player2'
          : 'player1';
      const cached = prev.get(card.id);
      const fresh = cardInstanceToGameCard(card, cardCounters, owner);
      next.set(
        card.id,
        cached && gameCardEquals(cached, fresh) ? cached : fresh,
      );
    }

    cacheRef.current = next;
    return next;
  }, [cards, counters, opponentPlayerId]);
}
