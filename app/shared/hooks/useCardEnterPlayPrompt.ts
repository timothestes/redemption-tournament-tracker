'use client';

import { useEffect, useRef } from 'react';
import { getAbilitiesForCard, type CardAbility } from '@/lib/cards/cardAbilities';
import {
  showCardChoicePrompt,
  dismissCardChoicePrompt,
} from '@/app/shared/components/CardChoicePrompt';

const PLAY_ZONES: ReadonlySet<string> = new Set([
  'territory',
  'land-of-bondage',
  'land-of-redemption',
]);

// Any of these → a play zone fires the prompt. Excludes paragon and soul-deck
// (different lifecycle) and the play zones themselves (cross-play moves don't
// re-prompt since the choice would already have been made).
const PROMPT_SOURCE_ZONES: ReadonlySet<string> = new Set([
  'hand',
  'deck',
  'reserve',
  'discard',
  'banish',
]);

export interface CardForPrompt {
  instanceId: string;
  cardName: string;
  zone: string;
}

interface Args {
  cards: CardForPrompt[];
  onChoose: (instanceId: string, abilityIndex: number) => void;
  enabled?: boolean;
}

/**
 * Watches a list of locally-owned cards and, when one of them transitions
 * from `hand` into a play zone, shows an interactive prompt offering each
 * `set_card_outline` ability defined for that card. Dismisses the prompt
 * automatically when the card leaves play (or is removed entirely).
 *
 * The hook is generic — any card whose registry entry contains
 * `set_card_outline` abilities will trigger a prompt on play. Three Woes is
 * the v1 target.
 */
export function useCardEnterPlayPrompt({ cards, onChoose, enabled = true }: Args) {
  const prevZonesRef = useRef<Map<string, string>>(new Map());
  const isInitialRef = useRef(true);
  const onChooseRef = useRef(onChoose);
  onChooseRef.current = onChoose;

  useEffect(() => {
    const currentZones = new Map(cards.map(c => [c.instanceId, c.zone]));

    if (!enabled) {
      prevZonesRef.current = currentZones;
      isInitialRef.current = false;
      return;
    }

    const prevZones = prevZonesRef.current;

    if (isInitialRef.current) {
      prevZonesRef.current = currentZones;
      isInitialRef.current = false;
      return;
    }

    for (const card of cards) {
      const prevZone = prevZones.get(card.instanceId);
      const currZone = card.zone;
      if (prevZone === currZone) continue;

      if (PROMPT_SOURCE_ZONES.has(prevZone ?? '') && PLAY_ZONES.has(currZone)) {
        const abilities = getAbilitiesForCard(card.cardName);
        const setOutlineChoices = abilities
          .map((ability, index) => ({ ability, index }))
          .filter(
            (entry): entry is {
              ability: Extract<CardAbility, { type: 'set_card_outline' }>;
              index: number;
            } => entry.ability.type === 'set_card_outline',
          );
        if (setOutlineChoices.length === 0) continue;

        const choices = setOutlineChoices.map(({ ability, index }) => ({
          label: ability.label,
          color: ability.color,
          onClick: () => {
            onChooseRef.current(card.instanceId, index);
            dismissCardChoicePrompt(card.instanceId);
          },
        }));

        showCardChoicePrompt({
          key: card.instanceId,
          message: card.cardName,
          choices,
        });
      } else if (PLAY_ZONES.has(prevZone ?? '') && !PLAY_ZONES.has(currZone)) {
        dismissCardChoicePrompt(card.instanceId);
      }
    }

    for (const instanceId of prevZones.keys()) {
      if (!currentZones.has(instanceId)) {
        dismissCardChoicePrompt(instanceId);
      }
    }

    prevZonesRef.current = currentZones;
  }, [cards, enabled]);
}
